/**
 * Works out the board from stored answers and live facts. Pure: callers pass in what the
 * database and registry say, so every status rule is testable without either.
 *
 * @module services/setup/board
 */

import type {
  BusinessType,
  SetupBoard,
  SetupChannelRef,
  SetupHandle,
  SetupPlaybookStep,
  SetupPluginRef,
  SetupQuestion,
  SetupRow,
  SetupSettings,
  SetupUpNext,
} from "@server/types/setup.types";
import type { SiteReading } from "./site";

/** A plugin the org can see, reduced to what setup needs. */
export interface BoardPlugin {
  id: string;
  name: string;
  handles: SetupHandle[];
  /** Business types the plugin's manifest suggests it for. */
  businessTypes: BusinessType[];
  /** The organization has really connected it. Unknown counts as not connected. */
  connected: boolean;
}

export interface BoardPlaybook {
  id: string;
  title: string;
  active: boolean;
  steps: SetupPlaybookStep[];
}

export interface BoardFacts {
  setup: SetupSettings;
  site: SiteReading;
  plugins: BoardPlugin[];
  playbooks: BoardPlaybook[];
  hasRealConversations: boolean;
  /** Picked channels, resolved by the service (needs the registry and instances). */
  channels: SetupChannelRef[];
}

/**
 * The platform that should handle `need`: one the customer chose, else one the manifests suggest
 * for their business type. A connected one wins, so a platform connected after the answers were
 * saved is still used. Undefined means no known platform handles it.
 *
 * A customer who saved their answers and picked no tools has not chosen a platform: manifests
 * must not choose for them, so only a platform they have really connected counts.
 */
export function pluginFor(
  need: SetupHandle,
  setup: SetupSettings,
  plugins: BoardPlugin[],
): BoardPlugin | undefined {
  const chosen = (p: BoardPlugin) => setup.toolPluginIds.includes(p.id);
  const suitable = (p: BoardPlugin) =>
    chosen(p) || (!!setup.businessType && p.businessTypes.includes(setup.businessType));
  const unchosen = !!setup.answeredAt && setup.toolPluginIds.length === 0;
  const rank = (p: BoardPlugin) => (p.connected ? 0 : 2) + (chosen(p) ? 0 : 1);

  return plugins
    .filter((p) => p.handles.includes(need) && suitable(p) && (!unchosen || p.connected))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))[0];
}

function platformRow(
  question: SetupQuestion,
  need: SetupHandle,
  base: Pick<
    SetupRow,
    "id" | "text" | "source" | "sources" | "answerDocumentId" | "linkedDocuments"
  >,
  facts: BoardFacts,
): SetupRow {
  const plugin = pluginFor(need, facts.setup, facts.plugins);
  const ref = plugin ? { plugin: { id: plugin.id, name: plugin.name } } : {};
  const playbook = question.playbookId
    ? facts.playbooks.find((p) => p.id === question.playbookId)
    : undefined;
  const withPlaybook = playbook
    ? { playbook: { id: playbook.id, title: playbook.title, steps: playbook.steps } }
    : {};

  // Nothing can act for the customer until a platform that handles this is connected.
  if (!plugin?.connected) return { ...base, needs: need, ...ref, status: "needs_connection" };

  if (playbook) {
    return {
      ...base,
      needs: need,
      ...ref,
      ...withPlaybook,
      status: playbook.active ? "ready" : "playbook_off",
    };
  }
  return {
    ...base,
    needs: need,
    ...ref,
    status: "playbook_missing",
    generation: question.playbookAttempt?.outcome ?? "pending",
  };
}

export function buildRow(question: SetupQuestion, facts: BoardFacts): SetupRow {
  const { site } = facts;
  const base = {
    id: question.id,
    text: question.text,
    source: question.source,
    sources: [] as SetupRow["sources"],
    ...(question.answerDocumentId ? { answerDocumentId: question.answerDocumentId } : {}),
    ...(question.linkedDocuments?.length ? { linkedDocuments: question.linkedDocuments } : {}),
  };

  if (question.needs) return platformRow(question, question.needs, base, facts);

  const reading = site.state.state === "reading";
  const check = question.check;

  if (!check) return { ...base, status: reading ? "reading_site" : "checking" };

  if (check.outcome === "failed") return { ...base, status: "check_failed" };

  if (check.outcome === "answered") {
    // Ready only after a real test turn passed. Pending, or stored before turns existed: testing.
    if (check.turn?.state !== "passed") return { ...base, status: "checking" };
    const sources = check.sources.map((source) =>
      source.documentId === question.answerDocumentId ? { ...source, own: true } : source,
    );
    return { ...base, status: "ready", answer: check.answer, sources };
  }

  // Not answered. While the site is still being read the answer may simply not be in yet, and a
  // check older than the last read has not seen the newest pages: neither is "missing".
  if (reading) return { ...base, status: "reading_site" };
  const checkedBeforeLastRead =
    !!site.syncedAt && new Date(check.checkedAt).getTime() < new Date(site.syncedAt).getTime();
  if (checkedBeforeLastRead) return { ...base, status: "checking" };
  return { ...base, status: "missing", ...(check.handedOff ? { handedOff: true } : {}) };
}

/** The need that most of `rows` share, so "so your assistant can ..." names the common one. */
function commonNeed(rows: SetupRow[]): SetupHandle | undefined {
  const counts = new Map<SetupHandle, number>();
  for (const row of rows) if (row.needs) counts.set(row.needs, (counts.get(row.needs) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function pickUpNext(rows: SetupRow[]): SetupUpNext {
  const needing = rows.filter((r) => r.status === "needs_connection");
  if (needing.length > 0) {
    const byPlugin = new Map<string, { plugin: SetupPluginRef; rows: SetupRow[] }>();
    for (const row of needing) {
      if (!row.plugin) continue;
      const entry = byPlugin.get(row.plugin.id) ?? { plugin: row.plugin, rows: [] };
      entry.rows.push(row);
      byPlugin.set(row.plugin.id, entry);
    }
    const best = [...byPlugin.values()].sort((a, b) => b.rows.length - a.rows.length)[0];
    if (best) {
      return {
        kind: "connect",
        plugin: best.plugin,
        unlocks: best.rows.length,
        capability: commonNeed(best.rows),
      };
    }
    return { kind: "choose_platform", unlocks: needing.length, capability: commonNeed(needing) };
  }

  const off = rows.find((r) => r.status === "playbook_off");
  if (off) {
    return { kind: "playbook", questionId: off.id, title: off.playbook?.title ?? off.text };
  }

  const unwritten = rows.find(
    (r) => r.status === "playbook_missing" && r.generation && r.generation !== "pending",
  );
  if (unwritten) return { kind: "write_playbook", questionId: unwritten.id, text: unwritten.text };

  const missing = rows.find((r) => r.status === "missing");
  if (missing) return { kind: "answer", questionId: missing.id, text: missing.text };

  return { kind: "done" };
}

/** True once every row, including platform rows, is ready. Only then is setup finished. */
export function isEverythingReady(rows: SetupRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.status === "ready");
}

export function buildBoard(facts: BoardFacts): SetupBoard {
  const { setup, site } = facts;
  const rows = setup.questions.map((q) => buildRow(q, facts));
  const open = !setup.finishedAt && !setup.dismissedAt;

  return {
    businessType: setup.businessType,
    website: setup.website,
    toolPluginIds: setup.toolPluginIds,
    toolPlugins: setup.toolPluginIds.flatMap((id) => {
      const plugin = facts.plugins.find((p) => p.id === id);
      return plugin ? [{ id: plugin.id, name: plugin.name }] : [];
    }),
    channels: setup.channels,
    channelRefs: facts.channels,
    rows,
    site: site.state,
    upNext: pickUpNext(rows),
    readyCount: rows.filter((r) => r.status === "ready").length,
    totalCount: rows.length,
    answeredAt: setup.answeredAt,
    dismissedAt: setup.dismissedAt,
    finishedAt: setup.finishedAt,
    shouldPrompt: open && !facts.hasRealConversations,
  };
}
