/**
 * Hand-off tickets: when a hand-off finds nobody available and the agent is
 * set to "create a ticket", the AI raises one in the merchant's helpdesk
 * instead of leaving the conversation waiting in the queue.
 *
 * Core never names a helpdesk: providers are the enabled plugins declaring the
 * `tickets` capability, reached over their core-only worker routes
 * `POST /tickets/form` and `POST /tickets/create` (plugin SDK types/tickets.ts).
 *
 * Flow: run.ts marks the conversation (`metadata.handoffTicket`, status
 * `requested`) and gives the planner the ticket instructions; the
 * `create_ticket` core tool calls `raise()`; after the turn, `closeIfRaised()`
 * resolves the conversation so it does not sit in the queue.
 *
 * @module services/handoff-tickets
 */

import { z } from "zod";
import { getDashboardUrl } from "@server/config/env";
import type { Conversation } from "@server/database/entities/conversation.entity";
import { MessageType, type Message } from "@server/database/entities/message.entity";
import { createLogger } from "@server/lib/logger";
import { conversationRepository } from "@server/repositories/conversation.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { hookManager } from "@server/services/hooks/hook-manager";
import type { HandoffTicketConfig, HandoffTicketState } from "@server/types/handoff-ticket.types";
import { getUTCNow } from "@server/utils/date.utils";

const logger = createLogger("handoff-tickets");

const TICKETS_CAPABILITY = "tickets";
const WORKER_TIMEOUT_MS = 20_000;
/** Zendesk comments cap at 64 KB; other helpdesks are similar. Keep the latest messages. */
const MAX_TRANSCRIPT_CHARS = 30_000;
export const TICKET_CLOSE_REASON = "ticket_created";

export interface TicketProvider {
  pluginId: string;
  name: string;
}

const fieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["select", "multiselect", "text", "checkbox", "number"]),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  description: z.string().optional(),
});
const errorSchema = z.object({
  ok: z.literal(false),
  code: z.enum(["NOT_CONNECTED", "INVALID_FIELDS", "PROVIDER_ERROR"]),
  message: z.string(),
});
const formReplySchema = z.union([
  z.object({ ok: z.literal(true), fields: z.array(fieldSchema) }),
  errorSchema,
]);
const createReplySchema = z.union([
  z.object({ ok: z.literal(true), ticketId: z.string(), ticketUrl: z.string().optional() }),
  errorSchema,
]);

// Declared rather than z.infer'd: ts-jest compiles without strictNullChecks,
// where inferred `ok` literals do not narrow.
type TicketFailure = {
  ok: false;
  code: "NOT_CONNECTED" | "INVALID_FIELDS" | "PROVIDER_ERROR";
  message: string;
};
export type TicketFormField = z.infer<typeof fieldSchema>;
export type TicketFormReply = { ok: true; fields: TicketFormField[] } | TicketFailure;
type TicketCreated = { ok: true; ticketId: string; ticketUrl?: string };

export type RaiseResult =
  | { created: true; ticketId: string; alreadyCreated?: boolean }
  | { created: false; missing: string[] }
  | { created: false; error: string };

type WorkerPort = (organizationId: string, pluginId: string) => Promise<number>;

async function defaultWorkerPort(organizationId: string, pluginId: string): Promise<number> {
  const { pluginManagerService } = await import("../plugin-manager.service");
  const worker = await pluginManagerService.getOrStartWorker(organizationId, pluginId);
  return worker.port;
}

export function readHandoffTicket(
  conversation: Pick<Conversation, "metadata">,
): HandoffTicketState | null {
  const value = conversation.metadata?.handoffTicket;
  return value && typeof value === "object" ? (value as HandoffTicketState) : null;
}

/** Merge into the conversation's current metadata (re-read first). */
async function saveHandoffTicket(
  conversationId: string,
  organizationId: string,
  state: HandoffTicketState,
): Promise<void> {
  const fresh = await conversationRepository.findById(conversationId);
  if (!fresh || fresh.organization_id !== organizationId) return;
  await conversationRepository.update(conversationId, organizationId, {
    metadata: { ...(fresh.metadata ?? {}), handoffTicket: state },
  });
}

/** Public lines only, oldest first, the latest ones kept when it is long. */
export function buildTicketTranscript(messages: Message[], customerName?: string | null): string {
  const labels: Partial<Record<string, string>> = {
    [MessageType.CUSTOMER]: customerName?.trim() || "Customer",
    [MessageType.BOT_AGENT]: "AI agent",
    [MessageType.HUMAN_AGENT]: "Team",
  };
  const transcript = messages
    .filter((m) => labels[m.type] && m.content?.trim())
    .map((m) => `${labels[m.type]}: ${m.content.trim()}`)
    .join("\n");
  return transcript.length > MAX_TRANSCRIPT_CHARS
    ? `…\n${transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS)}`
    : transcript;
}

const emailSchema = z.string().trim().email().max(254);

/** The planner's instructions for a hand-off that raises a ticket. */
export function ticketHandoffInstructions(
  availabilityContext: string,
  state: HandoffTicketState | null,
): string {
  if (state?.status === "created") {
    return `From this message forward you should follow these handoff instructions:

**Handoff Context:** ${availabilityContext}

**Instructions:**
A ticket was already raised with the team for this conversation. Do not call create_ticket again. Tell the customer the team has their request and will reply by email, and add anything new they said is noted in the conversation. Do not promise a time.`;
  }
  return `From this message forward you should follow these handoff instructions:

**Handoff Context:** ${availabilityContext}

**Instructions:**
Nobody from the team can take this conversation now, so raise a ticket for them:
1. You need a way for the team to reply. If you do not know the customer's email address, ask for it and wait for the answer.
2. Call create_ticket with a short subject and a summary of what the customer needs (what they asked, what you already checked or tried, order numbers and other details they gave). Write both in the customer's language.
3. When create_ticket confirms, tell the customer you raised a ticket with the team and they will get back to them by email. Do not promise a time and do not give the ticket number unless they ask.
If create_ticket fails, tell the customer their conversation is in the team's queue and they will reply as soon as someone is available.`;
}

export class HandoffTicketsService {
  constructor(private readonly deps: { workerPort?: WorkerPort } = {}) {}

  /** Enabled plugins of this organization that can raise tickets. */
  async listProviders(organizationId: string): Promise<TicketProvider[]> {
    const instances = await pluginInstanceRepository.findEnabledByOrganization(organizationId);
    return instances
      .filter((instance) => {
        // Stored manifests use the flat registry form (capabilities: string[]).
        const manifest = instance.plugin?.manifest as unknown as
          | { capabilities?: unknown }
          | undefined;
        return (
          Array.isArray(manifest?.capabilities) &&
          manifest.capabilities.includes(TICKETS_CAPABILITY)
        );
      })
      .map((instance) => ({ pluginId: instance.plugin.pluginId, name: instance.plugin.name }));
  }

  async isProvider(organizationId: string, pluginId: string): Promise<boolean> {
    const providers = await this.listProviders(organizationId);
    return providers.some((provider) => provider.pluginId === pluginId);
  }

  /** The fields the merchant can prefill, read from their connected account. */
  async readForm(organizationId: string, pluginId: string): Promise<TicketFormReply> {
    if (!(await this.isProvider(organizationId, pluginId))) {
      return { ok: false, code: "NOT_CONNECTED", message: "This plugin cannot create tickets" };
    }
    return this.callWorker<TicketFormReply>(
      organizationId,
      pluginId,
      "/tickets/form",
      {},
      formReplySchema,
    );
  }

  /** Raise the ticket for a conversation whose hand-off asked for one (`create_ticket`). */
  async raise(
    conversation: Conversation,
    input: { subject?: string; summary?: string; email?: string; name?: string },
  ): Promise<RaiseResult> {
    const fresh = await conversationRepository.findById(conversation.id);
    if (!fresh || fresh.organization_id !== conversation.organization_id) {
      return { created: false, error: "Conversation not found" };
    }
    const state = readHandoffTicket(fresh);
    if (!state) {
      return {
        created: false,
        error: "Only use create_ticket when your hand-off instructions say so",
      };
    }
    if (state.status === "created" && state.ticketId) {
      return { created: true, ticketId: state.ticketId, alreadyCreated: true };
    }

    const config: HandoffTicketConfig | null =
      fresh.agent?.human_handoff_unavailable_ticket ?? null;
    if (!config || config.pluginId !== state.pluginId) {
      return { created: false, error: "Ticket creation is no longer set up for this agent" };
    }

    const subject = input.subject?.trim();
    const summary = input.summary?.trim();
    const missing: string[] = [];
    if (!subject) missing.push("subject");
    if (!summary) missing.push("summary");

    const typedEmail = emailSchema.safeParse(input.email ?? "");
    const email = fresh.customer?.email || (typedEmail.success ? typedEmail.data : undefined);
    const phone = fresh.customer?.phone || undefined;
    if (!email && !phone) missing.push("the customer's email address");
    if (missing.length) return { created: false, missing };

    const name = fresh.customer?.name || input.name?.trim() || undefined;
    const reply = await this.callWorker<TicketCreated>(
      fresh.organization_id,
      config.pluginId,
      "/tickets/create",
      {
        subject,
        summary,
        transcript: buildTicketTranscript(await fresh.getMessages(), name),
        requester: { name, email, phone },
        fields: config.fields,
        conversation: {
          id: fresh.id,
          url: `${getDashboardUrl()}/conversations/${fresh.id}?org=${fresh.organization_id}`,
          channel: fresh.channel,
        },
      },
      createReplySchema,
    );

    if (!reply.ok) {
      const failure = reply as TicketFailure;
      logger.warn(
        { conversationId: fresh.id, pluginId: config.pluginId, code: failure.code },
        "Hand-off ticket failed",
      );
      await fresh.addMessage({
        content: `Could not create the ticket (${failure.code}): ${failure.message}. The conversation stays in the queue.`,
        type: MessageType.SYSTEM,
        metadata: { isHandoffTicket: true, ok: false, code: failure.code },
      });
      return { created: false, error: "The ticket could not be created" };
    }

    const created = reply as TicketCreated;
    await saveHandoffTicket(fresh.id, fresh.organization_id, {
      pluginId: config.pluginId,
      status: "created",
      ticketId: created.ticketId,
      ticketUrl: created.ticketUrl ?? null,
      createdAt: getUTCNow().toISOString(),
    });
    await fresh.addMessage({
      content: `Ticket #${created.ticketId} created${created.ticketUrl ? `: ${created.ticketUrl}` : ""}`,
      type: MessageType.SYSTEM,
      metadata: {
        isHandoffTicket: true,
        ok: true,
        pluginId: config.pluginId,
        ticketId: created.ticketId,
        ticketUrl: created.ticketUrl ?? null,
      },
    });
    logger.info(
      { conversationId: fresh.id, pluginId: config.pluginId, ticketId: created.ticketId },
      "Hand-off ticket created",
    );
    return { created: true, ticketId: created.ticketId };
  }

  /**
   * After a turn: a conversation whose ticket was raised leaves the queue. The
   * team follows up in the helpdesk; a new customer message reopens it.
   */
  async closeIfRaised(conversationId: string, organizationId: string): Promise<boolean> {
    const conversation = await conversationRepository.findById(conversationId);
    if (
      !conversation ||
      conversation.organization_id !== organizationId ||
      conversation.status !== "pending-human" ||
      readHandoffTicket(conversation)?.status !== "created"
    ) {
      return false;
    }
    await conversationRepository.update(conversationId, organizationId, {
      status: "resolved",
      ended_at: getUTCNow(),
      resolution_metadata: { resolved: false, confidence: 1.0, reason: TICKET_CLOSE_REASON },
    });
    await hookManager.trigger("conversation.resolved", {
      organizationId,
      conversationId,
      metadata: { reason: TICKET_CLOSE_REASON, resolved: false },
    });
    logger.debug({ conversationId }, "Closed conversation after raising its ticket");
    return true;
  }

  private async callWorker<T>(
    organizationId: string,
    pluginId: string,
    path: string,
    body: unknown,
    schema: z.ZodTypeAny,
  ): Promise<T | TicketFailure> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
    try {
      const port = await (this.deps.workerPort ?? defaultWorkerPort)(organizationId, pluginId);
      const response = await fetch(`http://localhost:${port}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 404) {
        return { ok: false, code: "NOT_CONNECTED", message: "This plugin cannot create tickets" };
      }
      const parsed = schema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        logger.warn({ pluginId, path, status: response.status }, "Invalid ticket reply");
        return { ok: false, code: "PROVIDER_ERROR", message: "The plugin gave an invalid answer" };
      }
      return parsed.data as T;
    } catch (error) {
      logger.error({ err: error, pluginId, path }, "Ticket call to plugin failed");
      return { ok: false, code: "PROVIDER_ERROR", message: "The plugin could not be reached" };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const handoffTicketsService = new HandoffTicketsService();

/** Mark a conversation's hand-off as raising a ticket with this plugin (keeps a created ticket). */
export async function requestHandoffTicket(
  conversation: Conversation,
  pluginId: string,
): Promise<HandoffTicketState> {
  const existing = readHandoffTicket(conversation);
  if (existing?.status === "created") return existing;
  const state: HandoffTicketState = { pluginId, status: "requested" };
  await saveHandoffTicket(conversation.id, conversation.organization_id, state);
  conversation.metadata = { ...(conversation.metadata ?? {}), handoffTicket: state };
  return state;
}
