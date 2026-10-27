import type { HayLogger } from "@hay/plugin-sdk/types";
import type { WhatsAppConnection } from "./connection.js";
import type { GraphClient, GraphTemplate, NewTemplate } from "./graph-client.js";

/**
 * Message templates of the connected Messaging account (D13-1, D13-5).
 *
 * Meta is the source of truth. Each worker runs one plugin instance (one org,
 * one number), so the store is that instance's in-memory copy: synced from
 * `GET /{waba}/message_templates` on start, on connect and on demand from the
 * settings page, and patched by the `message_template_status_update` /
 * `template_category_update` webhooks in between. A restarted worker simply
 * syncs again, so nothing needs a table in core.
 *
 * Templates are owned by the Messaging account Hay.chat created or was shared,
 * so a new customer has none: `ensureStarterTemplates` submits two utility
 * templates for Meta's review on connect (idempotent by name + language).
 */

export type ParameterFormat = "POSITIONAL" | "NAMED";

/** Why an approved template still cannot be sent from Hay.chat. */
export type UnsupportedReason = "header_media" | "header_variables" | "button_variables";

export interface StoredTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  rejectedReason?: string;
  /** BODY text with `{{1}}` / `{{name}}` placeholders. */
  body: string;
  parameterFormat: ParameterFormat;
  /** Body placeholder names in send order. */
  variables: string[];
  unsupported?: UnsupportedReason;
  /** Approved and fillable with body text only — what the picker offers. */
  sendable: boolean;
}

/** Core's channel-template contract (`GET /templates`). */
export interface ChannelTemplate {
  name: string;
  language: string;
  category?: string;
  body: string;
  variables: string[];
}

export interface TemplateSnapshot {
  templates: StoredTemplate[];
  lastSyncedAt: string | null;
  error: string | null;
}

/** Starter templates every connected number gets (Roger, 27 Oct 2026). */
export const STARTER_TEMPLATES: NewTemplate[] = [
  {
    name: "hay_we_replied",
    language: "en",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Hi! Our team has replied to your message. Reply here and we'll continue the conversation.",
      },
    ],
  },
  {
    name: "hay_we_replied",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Olá! Nossa equipe respondeu à sua mensagem. Responda aqui para continuarmos a conversa.",
      },
    ],
  },
  {
    name: "hay_handoff_to_person",
    language: "en",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Thanks for your message. I've passed it to the team, and a person will reply to you here in this chat.",
      },
    ],
  },
  {
    name: "hay_handoff_to_person",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Obrigado pela sua mensagem. Encaminhei para a equipe, e uma pessoa vai responder você aqui neste chat.",
      },
    ],
  },
];

export const DEFAULT_HANDOFF_TEMPLATE = "hay_handoff_to_person";

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/** Placeholder names in order of first appearance. */
export function placeholders(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/** Meta status events → stored status. */
function normaliseStatus(event: string): string {
  return event === "REINSTATED" ? "APPROVED" : event;
}

export function toStoredTemplate(template: GraphTemplate): StoredTemplate {
  const components = template.components ?? [];
  const body = components.find((c) => c.type === "BODY")?.text ?? "";
  const header = components.find((c) => c.type === "HEADER");
  const buttons = components.find((c) => c.type === "BUTTONS")?.buttons ?? [];

  let unsupported: UnsupportedReason | undefined;
  if (header && header.format && header.format !== "TEXT") {
    unsupported = "header_media";
  } else if (header?.text && placeholders(header.text).length > 0) {
    unsupported = "header_variables";
  } else if (buttons.some((button) => button.url && placeholders(button.url).length > 0)) {
    unsupported = "button_variables";
  }

  const status = normaliseStatus(template.status ?? "UNKNOWN");
  return {
    id: template.id,
    name: template.name,
    language: template.language,
    status,
    category: template.category,
    rejectedReason:
      template.rejected_reason && template.rejected_reason !== "NONE"
        ? template.rejected_reason
        : undefined,
    body,
    parameterFormat: template.parameter_format === "NAMED" ? "NAMED" : "POSITIONAL",
    variables: placeholders(body),
    unsupported,
    sendable: status === "APPROVED" && !unsupported && body.length > 0,
  };
}

const keyOf = (name: string, language: string) => `${name}::${language}`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TemplateStore {
  private templates = new Map<string, StoredTemplate>();
  private lastSyncedAt: Date | null = null;
  private lastError: string | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly graph: GraphClient,
    private readonly logger: HayLogger,
  ) {}

  /** Replace the store with Meta's current list. Concurrent calls share one request. */
  sync(connection: WhatsAppConnection): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.fetchAll(connection).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async fetchAll(connection: WhatsAppConnection): Promise<void> {
    try {
      const fetched = await this.graph.listTemplates(connection.wabaId, connection.accessToken);
      const next = new Map<string, StoredTemplate>();
      for (const template of fetched) {
        if (!template?.name || !template.language) continue;
        const stored = toStoredTemplate(template);
        next.set(keyOf(stored.name, stored.language), stored);
      }
      this.templates = next;
      this.lastSyncedAt = new Date();
      this.lastError = null;
      this.logger.info("WhatsApp templates synced", { count: next.size });
    } catch (error: unknown) {
      this.lastError = errorMessage(error);
      this.logger.warn("WhatsApp template sync failed", { error: this.lastError });
    }
  }

  /** Sync once if this worker never has. Never throws. */
  async ensureSynced(connection: WhatsAppConnection): Promise<void> {
    if (!this.lastSyncedAt) {
      await this.sync(connection);
    }
  }

  snapshot(): TemplateSnapshot {
    return {
      templates: [...this.templates.values()].sort(
        (a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language),
      ),
      lastSyncedAt: this.lastSyncedAt?.toISOString() ?? null,
      error: this.lastError,
    };
  }

  /** What core's template picker may offer. */
  sendable(): ChannelTemplate[] {
    return this.snapshot()
      .templates.filter((template) => template.sendable)
      .map(({ name, language, category, body, variables }) => ({
        name,
        language,
        category,
        body,
        variables,
      }));
  }

  find(name: string, language: string): StoredTemplate | undefined {
    return this.templates.get(keyOf(name, language));
  }

  /**
   * The sendable language of `name` closest to `preferred` (e.g. "pt" →
   * "pt_BR"), else English, else any.
   */
  pickLanguage(name: string, preferred: string | null | undefined): StoredTemplate | undefined {
    const candidates = [...this.templates.values()].filter((t) => t.name === name && t.sendable);
    const base = (code: string) => code.toLowerCase().split(/[_-]/)[0];
    const wanted = preferred?.toLowerCase().replace("-", "_");
    return (
      (wanted && candidates.find((t) => t.language.toLowerCase() === wanted)) ||
      (wanted && candidates.find((t) => base(t.language) === base(wanted))) ||
      candidates.find((t) => base(t.language) === "en") ||
      candidates[0]
    );
  }

  /**
   * `message_template_status_update`: patch the matching template. Returns
   * false when the template is unknown, so the caller can resync.
   */
  applyStatusUpdate(value: Record<string, unknown>): boolean {
    const template = this.locate(value);
    const event = typeof value.event === "string" ? value.event : undefined;
    if (!template || !event) return false;

    if (event === "DELETED") {
      this.templates.delete(keyOf(template.name, template.language));
      return true;
    }
    const status = normaliseStatus(event);
    const reason =
      typeof value.reason === "string" && value.reason !== "NONE" ? value.reason : undefined;
    this.templates.set(keyOf(template.name, template.language), {
      ...template,
      status,
      rejectedReason: status === "REJECTED" ? (reason ?? template.rejectedReason) : undefined,
      sendable: status === "APPROVED" && !template.unsupported && template.body.length > 0,
    });
    return true;
  }

  /** `template_category_update`: Meta moved a template to another category. */
  applyCategoryUpdate(value: Record<string, unknown>): boolean {
    const template = this.locate(value);
    const category = typeof value.new_category === "string" ? value.new_category : undefined;
    if (!template || !category) return false;
    this.templates.set(keyOf(template.name, template.language), { ...template, category });
    return true;
  }

  private locate(value: Record<string, unknown>): StoredTemplate | undefined {
    const id = value.message_template_id;
    if (id !== undefined && id !== null) {
      const byId = [...this.templates.values()].find((t) => t.id === String(id));
      if (byId) return byId;
    }
    const name = value.message_template_name;
    const language = value.message_template_language;
    return typeof name === "string" && typeof language === "string"
      ? this.templates.get(keyOf(name, language))
      : undefined;
  }

  /**
   * Submit the starter templates the account does not have yet (D13-5). Runs
   * only after a successful sync, so it never re-submits blindly. A template
   * Meta already holds (or is deleting) under that name is logged, not retried.
   */
  async ensureStarterTemplates(connection: WhatsAppConnection): Promise<number> {
    if (!this.lastSyncedAt || this.lastError) return 0;
    let created = 0;
    for (const starter of STARTER_TEMPLATES) {
      if (this.find(starter.name, starter.language)) continue;
      try {
        const result = await this.graph.createTemplate(
          connection.wabaId,
          connection.accessToken,
          starter,
        );
        const body = String(starter.components[0]?.text ?? "");
        this.templates.set(keyOf(starter.name, starter.language), {
          id: result.id ?? "",
          name: starter.name,
          language: starter.language,
          status: result.status ?? "PENDING",
          category: result.category ?? starter.category,
          body,
          parameterFormat: "POSITIONAL",
          variables: placeholders(body),
          sendable: result.status === "APPROVED",
        });
        created++;
      } catch (error: unknown) {
        this.logger.warn("WhatsApp starter template not created", {
          name: starter.name,
          language: starter.language,
          error: errorMessage(error),
        });
      }
    }
    if (created > 0) {
      this.logger.info("WhatsApp starter templates submitted for review", { created });
    }
    return created;
  }
}
