/**
 * Loads one Casa Aurora store's knowledge, playbooks, agent and settings into a Hay.chat org.
 * Idempotent: documents, playbooks and the agent are matched by title/name and updated in place;
 * settings are set to fixed values. In dry-run nothing is sent, not even reads, so it needs no
 * credentials: every item is reported as "create". Playbook tool references are always also
 * checked offline against the plugin sources.
 */
import type { Platform } from "../lib/types";
import { agentDefinition } from "./agent";
import {
  LOCALE_BY_PLATFORM,
  loadKnowledge,
  loadPlaybooks,
  type KnowledgeDoc,
  type PlaybookFile,
} from "./content";
import { markdownToTiptap } from "./markdown";
import { listPluginTools, pluginIdForTool } from "./tools";

/** The two tRPC calls the seed needs; HayApi from tools/hay-cli/src/api.ts fits. */
export interface TrpcClient {
  query<T>(path: string, input?: unknown): Promise<T>;
  mutation<T>(path: string, input?: unknown): Promise<T>;
}

export type Step = "settings" | "agent" | "docs" | "playbooks";
export const STEPS: Step[] = ["settings", "agent", "docs", "playbooks"];

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
  agents?: { id: string }[];
}
interface RemoteAgent {
  id: string;
  name: string;
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
    const result = await api.query<ListPage<RemoteDocument>>("documents.list", { pagination: { page, limit: 100 } });
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
      if (!tools.has(action)) warnings.push(`${playbook.file}: {{action:${action}}} is not a ${platform} tool`);
    }
  }
  return warnings;
}

export async function seedHay(api: TrpcClient | null, options: SeedOptions): Promise<SeedReport> {
  const log = options.log ?? ((line: string) => console.log(line));
  const { platform, dryRun } = options;
  const locale = LOCALE_BY_PLATFORM[platform];
  const report: SeedReport = { created: [], updated: [], unchanged: [], actionWarnings: [] };
  if (!dryRun && !api) throw new Error("seedHay needs an API client unless dryRun is set");
  const client = api as TrpcClient;
  const write = (verb: "create" | "update", what: string) => {
    (verb === "create" ? report.created : report.updated).push(what);
    log(`  ${dryRun ? "[dry-run] would " : ""}${verb} ${what}`);
  };

  const docs: KnowledgeDoc[] = options.steps.has("docs") ? loadKnowledge(platform) : [];
  const playbooks: PlaybookFile[] = options.steps.has("playbooks") ? loadPlaybooks(platform) : [];

  // ---- settings: time zone, language, business hours, quick check
  if (options.steps.has("settings")) {
    log(`Settings (${TIMEZONES[platform]}, ${locale})`);
    const settings = { timezone: TIMEZONES[platform], defaultLanguage: locale === "pt-BR" ? "pt" : "en" };
    if (!dryRun) await client.mutation("organizations.updateSettings", settings);
    write("update", `organization settings ${JSON.stringify(settings)}`);

    const schedule = {
      name: SCHEDULE_NAME,
      timezone: TIMEZONES[platform],
      channels: [] as string[],
      weeklyHours: WEEKLY_HOURS,
    };
    const existing = dryRun
      ? undefined
      : (await client.query<Schedule[]>("businessHours.list")).find((s) => s.channels.length === 0);
    if (existing) {
      // Keep closures someone added in the dashboard (holidays).
      await client.mutation("businessHours.update", { ...schedule, id: existing.id, closures: existing.closures });
      write("update", `business hours "${SCHEDULE_NAME}" Mon–Fri 09:00–18:00`);
    } else {
      if (!dryRun) await client.mutation("businessHours.create", { ...schedule, closures: [] });
      write("create", `business hours "${SCHEDULE_NAME}" Mon–Fri 09:00–18:00`);
    }

    if (options.quickCheck !== undefined) {
      const current = dryRun
        ? { updateAfterMinutes: 5, giveUpAfterMinutes: 10 }
        : await client.query<{ updateAfterMinutes: number; giveUpAfterMinutes: number }>("teamQuestions.getSettings");
      const input = {
        enabled: options.quickCheck,
        updateAfterMinutes: current.updateAfterMinutes,
        giveUpAfterMinutes: current.giveUpAfterMinutes,
      };
      if (!dryRun) await client.mutation("teamQuestions.updateSettings", input);
      write("update", `quick check ${options.quickCheck ? "on" : "off"}`);
    }
  }

  // ---- agent
  let agentId: string | undefined;
  if (options.steps.has("agent") || options.steps.has("playbooks")) {
    const definition = agentDefinition(locale);
    const agents = dryRun ? [] : await client.query<RemoteAgent[]>("agents.list");
    agentId = agents.find((a) => a.name === definition.name)?.id;
    if (options.steps.has("agent")) {
      log(`Agent "${definition.name}"`);
      const data = {
        name: definition.name,
        description: definition.description,
        enabled: true,
        language: definition.language,
        tone: definition.tone,
        avoid: definition.avoid,
        instructions: markdownToTiptap(definition.instructions, pluginIdForTool),
      };
      if (agentId) {
        await client.mutation("agents.update", { id: agentId, data });
        write("update", `agent "${definition.name}"`);
      } else {
        if (!dryRun) agentId = (await client.mutation<RemoteAgent>("agents.create", data)).id;
        write("create", `agent "${definition.name}"`);
      }
      // The demo org answers as Casa Aurora: make it the default agent.
      if (!dryRun) await client.mutation("agents.setAsDefault", { agentId });
      log(`  ${dryRun ? "[dry-run] would set" : "set"} it as the default agent`);
    }
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
        await client.mutation("documents.update", { id: match.id, title: doc.title, content: doc.content, status: "published" });
        write("update", `document "${doc.title}"`);
      } else {
        if (!dryRun) {
          await client.mutation("documents.create", { title: doc.title, content: doc.content, type: doc.type, status: "published" });
        }
        write("create", `document "${doc.title}"`);
      }
    }
  }

  // ---- playbooks
  if (options.steps.has("playbooks")) {
    log(`Playbooks (${playbooks.length}, ${options.playbookStatus})`);
    if (!dryRun && !agentId) throw new Error(`Agent "${agentDefinition(locale).name}" not found: run with the agent step first`);
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
        const agentIds = [...new Set([...(match.agents ?? []).map((a) => a.id), agentId as string])];
        saved = await client.mutation<SavedPlaybook>("playbooks.update", {
          id: match.id,
          data: { ...fields, agentIds, approvalCategories: playbook.approvalCategories },
        });
        write("update", `playbook "${playbook.title}"`);
      } else {
        if (!dryRun) {
          saved = await client.mutation<SavedPlaybook>("playbooks.create", { ...fields, agentIds: [agentId] });
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
      for (const warning of saved?.actionWarnings ?? []) report.actionWarnings.push(`${playbook.title}: ${warning}`);
    }
    // Checked against the plugin sources too, so a typo shows even when the plugin isn't connected.
    report.actionWarnings.push(...offlineActionWarnings(platform, playbooks));
  }

  return report;
}
