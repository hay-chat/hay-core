/**
 * Works out the board from stored answers and live facts. Pure: callers pass in what the
 * database and registry say, so every status rule is testable without either.
 *
 * @module services/setup/board
 */

import type {
  SetupBoard,
  SetupHandle,
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
}

export interface BoardPlaybook {
  id: string;
  title: string;
  active: boolean;
}

export interface BoardFacts {
  setup: SetupSettings;
  site: SiteReading;
  plugins: BoardPlugin[];
  playbooks: BoardPlaybook[];
  hasRealConversations: boolean;
}

/** The chosen platform that handles `need`, if any. */
function pluginFor(
  need: SetupHandle,
  chosen: string[],
  plugins: BoardPlugin[],
): SetupPluginRef | undefined {
  for (const id of chosen) {
    const plugin = plugins.find((p) => p.id === id);
    if (plugin?.handles.includes(need)) return { id: plugin.id, name: plugin.name };
  }
  return undefined;
}

export function buildRow(question: SetupQuestion, facts: BoardFacts): SetupRow {
  const { setup, site, plugins, playbooks } = facts;
  const base = {
    id: question.id,
    text: question.text,
    source: question.source,
    sources: [] as SetupRow["sources"],
  };

  if (question.needs) {
    const plugin = pluginFor(question.needs, setup.toolPluginIds, plugins);
    const playbook = question.playbookId
      ? playbooks.find((p) => p.id === question.playbookId)
      : undefined;
    return {
      ...base,
      needs: question.needs,
      ...(plugin ? { plugin } : {}),
      ...(playbook ? { playbook: { id: playbook.id, title: playbook.title, steps: [] } } : {}),
      status: !playbook ? "needs_connection" : playbook.active ? "ready" : "playbook_off",
    };
  }

  const reading = site.state.state === "reading";
  const check = question.check;

  if (!check) return { ...base, status: reading ? "reading_site" : "checking" };

  if (check.outcome === "failed") return { ...base, status: "check_failed" };

  if (check.outcome === "answered") {
    return { ...base, status: "ready", answer: check.answer, sources: check.sources };
  }

  // Not answered. While the site is still being read the answer may simply not be in yet, and a
  // check older than the last read has not seen the newest pages: neither is "missing".
  if (reading) return { ...base, status: "reading_site" };
  const checkedBeforeLastRead =
    !!site.syncedAt && new Date(check.checkedAt).getTime() < new Date(site.syncedAt).getTime();
  return { ...base, status: checkedBeforeLastRead ? "checking" : "missing" };
}

export function pickUpNext(rows: SetupRow[]): SetupUpNext {
  const needing = rows.filter((r) => r.status === "needs_connection");
  if (needing.length > 0) {
    const byPlugin = new Map<string, { plugin: SetupPluginRef; unlocks: number }>();
    for (const row of needing) {
      if (!row.plugin) continue;
      const entry = byPlugin.get(row.plugin.id) ?? { plugin: row.plugin, unlocks: 0 };
      entry.unlocks += 1;
      byPlugin.set(row.plugin.id, entry);
    }
    const best = [...byPlugin.values()].sort((a, b) => b.unlocks - a.unlocks)[0];
    if (best) return { kind: "connect", plugin: best.plugin, unlocks: best.unlocks };
    return { kind: "choose_platform", unlocks: needing.length };
  }

  const off = rows.find((r) => r.status === "playbook_off");
  if (off) {
    return { kind: "playbook", questionId: off.id, title: off.playbook?.title ?? off.text };
  }

  const missing = rows.find((r) => r.status === "missing");
  if (missing) return { kind: "answer", questionId: missing.id, text: missing.text };

  return { kind: "done" };
}

export function buildBoard(facts: BoardFacts): SetupBoard {
  const { setup, site } = facts;
  const rows = setup.questions.map((q) => buildRow(q, facts));
  const open = !setup.finishedAt && !setup.dismissedAt;

  return {
    businessType: setup.businessType,
    website: setup.website,
    toolPluginIds: setup.toolPluginIds,
    channels: setup.channels,
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
