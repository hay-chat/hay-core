/**
 * Loads one Casa Aurora store's knowledge, playbooks, assistant and settings into a Hay.chat org.
 * Idempotent: documents and playbooks are matched by title and updated in place; the assistant
 * and settings are set to fixed values. In dry-run nothing is sent, not even reads, so it needs no
 * credentials: every item is reported as "create". Playbook tool references are always also
 * checked offline against the plugin sources.
 */
import type { Locale, Platform } from "../lib/types";
import { assistantDefinition, type AssistantDefinition } from "./assistant";
import {
  LOCALE_BY_PLATFORM,
  loadKnowledge,
  loadPlaybooks,
  type KnowledgeDoc,
  type PlaybookFile,
} from "./content";
import { markdownToTiptap, type ActionResolver } from "./markdown";
import { listPluginTools, pluginIdForTool } from "./tools";

/** The two tRPC calls the seed needs; HayApi from tools/hay-cli/src/api.ts fits. */
export interface TrpcClient {
  query<T>(path: string, input?: unknown): Promise<T>;
  mutation<T>(path: string, input?: unknown): Promise<T>;
}

export type Step = "settings" | "assistant" | "docs" | "playbooks";
export const STEPS: Step[] = ["settings", "assistant", "docs", "playbooks"];

/**
 * What one seed loads into an org. A Casa Aurora store builds it from tools/demo-account
 * (`casaAuroraContent`); other callers, such as tools/hay-assistant, build their own and reuse
 * `applySeed` so the create/update/dry-run logic exists once.
 */
export interface SeedContent {
  /** Shown in the log line of the assistant step. */
  locale: Locale;
  /** Org time zone, language and team hours. Leave out to skip the settings step. */
  settings?: { timezone: string; defaultLanguage: string; scheduleName: string };
  /** Leave out to skip the assistant step. */
  assistant?: AssistantDefinition;
  /** Maps an {{action:tool}} name in the assistant instructions to its plugin id. */
  resolveAction: ActionResolver;
  docs: KnowledgeDoc[];
  playbooks: PlaybookFile[];
  /** Offline check that every playbook action names a real tool; returns warnings. */
  checkActions: (playbooks: PlaybookFile[]) => string[];
}

export interface SeedOptions {
  platform: Platform;
  dryRun: boolean;
  /** Playbook status to write: active (the AI uses them) or draft. */
  playbookStatus: "active" | "draft";
  steps: Set<Step>;
  /** Set the org's Quick check with the team on or off; undefined leaves it alone. */
  quickCheck?: boolean;
  log?: (line: string) => void;
}

export interface SeedReport {
  created: string[];
  updated: string[];
  unchanged: string[];
  /** validateReferencedActions warnings from the server, or offline tool checks in dry-run. */
  actionWarnings: string[];
}

/** Store time zone per platform (company/brand.md). */
export const TIMEZONES: Record<Platform, string> = {
  shopify: "America/New_York",
  woocommerce: "Europe/Lisbon",
  nuvemshop: "America/Sao_Paulo",
};

const SCHEDULE_NAME = "Casa Aurora team hours";
/** Monday to Friday, 09:00–18:00 (day 0 = Sunday). */
export const WEEKLY_HOURS = [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "18:00" }));

interface ListPage<T> {
  items: T[];
  pagination: { hasNext: boolean };
}
interface RemoteDocument {
  id: string;
  title: string;
  content?: string | null;
  status?: string;
}
interface RemotePlaybook {
  id: string;
  title: string;
}
interface Schedule {
  id: string;
  name: string;
  timezone: string;
  channels: string[];
  weeklyHours: unknown[];
  closures: { date: string; endDate?: string | null; label?: string | null }[];
}
interface SavedPlaybook {
  id: string;
  actionWarnings?: string[];
}

async function listAllDocuments(api: TrpcClient): Promise<RemoteDocument[]> {
  const all: RemoteDocument[] = [];
  for (let page = 1; ; page++) {
    const result = await api.query<ListPage<RemoteDocument>>("documents.list", {
      pagination: { page, limit: 100 },
    });
    all.push(...result.items);
    if (!result.pagination.hasNext) return all;
  }
}

/** Offline check: every placeholder names a tool the store's plugin registers. */
export function offlineActionWarnings(platform: Platform, playbooks: PlaybookFile[]): string[] {
  const tools = new Set(listPluginTools(platform));
  const warnings: string[] = [];
  for (const playbook of playbooks) {
    for (const action of playbook.actions) {
      if (!tools.has(action))
        warnings.push(`${playbook.file}: {{action:${action}}} is not a ${platform} tool`);
    }
  }
  return warnings;
}

/** The Casa Aurora content of one store: its knowledge, playbooks, assistant and settings. */
export function casaAuroraContent(platform: Platform, steps: Set<Step>): SeedContent {
  const locale = LOCALE_BY_PLATFORM[platform];
  return {
    locale,
    settings: {
      timezone: TIMEZONES[platform],
      defaultLanguage: locale === "pt-BR" ? "pt" : "en",
      scheduleName: SCHEDULE_NAME,
    },
    assistant: assistantDefinition(locale),
    resolveAction: pluginIdForTool,
    docs: steps.has("docs") ? loadKnowledge(platform) : [],
    playbooks: steps.has("playbooks") ? loadPlaybooks(platform) : [],
    checkActions: (playbooks) => offlineActionWarnings(platform, playbooks),
  };
}

export async function seedHay(api: TrpcClient | null, options: SeedOptions): Promise<SeedReport> {
  return applySeed(api, casaAuroraContent(options.platform, options.steps), options);
}

export async function applySeed(
  api: TrpcClient | null,
  content: SeedContent,
  options: Pick<SeedOptions, "dryRun" | "playbookStatus" | "steps" | "quickCheck" | "log">,
): Promise<SeedReport> {
  const log = options.log ?? ((line: string) => console.log(line));
  const { dryRun } = options;
  const { locale, docs, playbooks } = content;
  const report: SeedReport = { created: [], updated: [], unchanged: [], actionWarnings: [] };
  if (!dryRun && !api) throw new Error("seedHay needs an API client unless dryRun is set");
  const client = api as TrpcClient;
  const write = (verb: "create" | "update", what: string) => {
    (verb === "create" ? report.created : report.updated).push(what);
    log(`  ${dryRun ? "[dry-run] would " : ""}${verb} ${what}`);
  };

  // ---- settings: time zone, language, business hours, quick check
  if (options.steps.has("settings") && content.settings) {
    const { scheduleName } = content.settings;
    log(`Settings (${content.settings.timezone}, ${locale})`);
    const settings = {
      timezone: content.settings.timezone,
      defaultLanguage: content.settings.defaultLanguage,
    };
    if (!dryRun) await client.mutation("organizations.updateSettings", settings);
    write("update", `organization settings ${JSON.stringify(settings)}`);

    const schedule = {
      name: scheduleName,
      timezone: content.settings.timezone,
      channels: [] as string[],
      weeklyHours: WEEKLY_HOURS,
    };
    const existing = dryRun
      ? undefined
      : (await client.query<Schedule[]>("businessHours.list")).find((s) => s.channels.length === 0);
    if (existing) {
      // Keep closures someone added in the dashboard (holidays).
      await client.mutation("businessHours.update", {
        ...schedule,
        id: existing.id,
        closures: existing.closures,
      });
      write("update", `business hours "${scheduleName}" Mon–Fri 09:00–18:00`);
    } else {
      if (!dryRun) await client.mutation("businessHours.create", { ...schedule, closures: [] });
      write("create", `business hours "${scheduleName}" Mon–Fri 09:00–18:00`);
    }

    if (options.quickCheck !== undefined) {
      const current = dryRun
        ? { updateAfterMinutes: 5, giveUpAfterMinutes: 10 }
        : await client.query<{ updateAfterMinutes: number; giveUpAfterMinutes: number }>(
            "teamQuestions.getSettings",
          );
      const input = {
        enabled: options.quickCheck,
        updateAfterMinutes: current.updateAfterMinutes,
        giveUpAfterMinutes: current.giveUpAfterMinutes,
      };
      if (!dryRun) await client.mutation("teamQuestions.updateSettings", input);
      write("update", `quick check ${options.quickCheck ? "on" : "off"}`);
    }
  }

  // ---- assistant (one per org: the org answers as Casa Aurora)
  if (options.steps.has("assistant") && content.assistant) {
    const definition = content.assistant;
    log(`Assistant "${definition.name}"`);
    if (!dryRun) {
      await client.mutation("organizations.assistant.update", {
        name: definition.name,
        description: definition.description,
        tone: definition.tone,
        avoid: definition.avoid,
        instructions: markdownToTiptap(definition.instructions, content.resolveAction),
      });
    }
    write("update", `assistant "${definition.name}"`);
  }

  // ---- knowledge documents
  if (options.steps.has("docs")) {
    log(`Knowledge (${docs.length} documents, ${locale})`);
    const existing = dryRun ? [] : await listAllDocuments(client);
    for (const doc of docs) {
      const match = existing.find((d) => d.title === doc.title);
      if (match && match.content === doc.content && match.status === "published") {
        report.unchanged.push(`document "${doc.title}"`);
        log(`  unchanged document "${doc.title}"`);
      } else if (match) {
        await client.mutation("documents.update", {
          id: match.id,
          title: doc.title,
          content: doc.content,
          status: "published",
        });
        write("update", `document "${doc.title}"`);
      } else {
        if (!dryRun) {
          await client.mutation("documents.create", {
            title: doc.title,
            content: doc.content,
            type: doc.type,
            status: "published",
          });
        }
        write("create", `document "${doc.title}"`);
      }
    }
  }

  // ---- playbooks
  if (options.steps.has("playbooks")) {
    log(`Playbooks (${playbooks.length}, ${options.playbookStatus})`);
    const existing = dryRun ? [] : await client.query<RemotePlaybook[]>("playbooks.list");
    for (const playbook of playbooks) {
      const match = existing.find((p) => p.title === playbook.title);
      const fields = {
        title: playbook.title,
        trigger: playbook.trigger,
        description: playbook.description,
        instructions: playbook.instructions,
        status: options.playbookStatus,
      };
      let saved: SavedPlaybook | undefined;
      if (match) {
        saved = await client.mutation<SavedPlaybook>("playbooks.update", {
          id: match.id,
          data: { ...fields, approvalCategories: playbook.approvalCategories },
        });
        // The assistant reads the active version, which playbooks.update leaves untouched.
        if (!dryRun) {
          await client.mutation("playbooks.versions.saveDraft", {
            playbookId: match.id,
            instructions: playbook.instructions,
          });
          await client.mutation("playbooks.versions.publish", {
            playbookId: match.id,
            note: "Published by the seed script",
          });
        }
        write("update", `playbook "${playbook.title}"`);
      } else {
        if (!dryRun) {
          saved = await client.mutation<SavedPlaybook>("playbooks.create", fields);
          // create takes no approvalCategories; update sets them.
          if (playbook.approvalCategories.length > 0) {
            saved = await client.mutation<SavedPlaybook>("playbooks.update", {
              id: saved.id,
              data: { approvalCategories: playbook.approvalCategories },
            });
          }
        }
        write("create", `playbook "${playbook.title}"`);
      }
      for (const warning of saved?.actionWarnings ?? [])
        report.actionWarnings.push(`${playbook.title}: ${warning}`);
    }
    // Checked against the plugin sources too, so a typo shows even when the plugin isn't connected.
    report.actionWarnings.push(...content.checkActions(playbooks));
  }

  return report;
}
