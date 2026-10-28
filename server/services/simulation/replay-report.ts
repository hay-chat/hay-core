/**
 * Replay report (D7-11): the judged turns of a run, grouped into buckets with
 * a few examples each, side by side with what was really sent. Counts and
 * examples only, never a headline percentage: a sample of past conversations
 * is an estimate, and the report says so with its sample size.
 */

import type { SimulationRun } from "@server/database/entities/simulation-run.entity";
import type { SimulationRunItem } from "@server/database/entities/simulation-run-item.entity";
import { REPLAY_BUCKETS, type ReplayBucket, type VerdictTool } from "./turn-judge.service";

/** Examples shown per bucket (Roger: 3-5). */
export const REPORT_EXAMPLES_PER_BUCKET = 5;

export interface ReplayReportExample {
  itemId: string;
  title: string | null;
  /** The shopper's message the AI answered. */
  customerMessage: string;
  reply: string | null;
  /** What was really sent next (replays), or null. */
  referenceReply: string | null;
  expectedOutcome: string | null;
  /** Writes the AI would have made, simulated (not sent). */
  mockedCalls: VerdictTool[];
  storeDataChanged: boolean;
  agreement: string | null;
  reasoning: string | null;
  passed: boolean | null;
  /** The playbook the AI followed, for "Improve from conversation". */
  playbookId: string | null;
  /** The simulated conversation (history + the AI's reply), for "Improve from conversation". */
  conversationId: string | null;
  /** The real Hay.chat conversation that was replayed, when there is one. */
  sourceConversationId: string | null;
}

export interface ReplayReportBucket {
  bucket: ReplayBucket;
  count: number;
  examples: ReplayReportExample[];
}

export interface ReplayReport {
  run: SimulationRun;
  /** Judged turns: the size of the sample every count is out of. */
  sampleSize: number;
  /** Turns still queued or being answered. */
  inProgress: number;
  /** Turns that errored or were skipped (cancelled, token ceiling). */
  notJudged: number;
  buckets: ReplayReportBucket[];
  /** How the answered turns compare with the human reply (counts, not %). */
  agreement: { same: number; partial: number; different: number };
}

function lastCustomerMessage(item: SimulationRunItem): string {
  for (let i = item.seed.length - 1; i >= 0; i--) {
    if (item.seed[i].role === "customer") return item.seed[i].text;
  }
  return "";
}

/** "conversation:<id>:<turn>" → <id>. */
function sourceConversationId(sourceRef: string | null): string | null {
  const match = sourceRef?.match(/^conversation:([0-9a-f-]{36}):\d+$/);
  return match ? match[1] : null;
}

export function toReportExample(item: SimulationRunItem): ReplayReportExample {
  const verdict = item.verdict;
  return {
    itemId: item.id,
    title: item.expectations?.title ?? null,
    customerMessage: lastCustomerMessage(item),
    reply: verdict?.reply ?? null,
    referenceReply: item.expectations?.referenceReply ?? null,
    expectedOutcome: item.expectations?.expectedOutcome ?? null,
    mockedCalls: (verdict?.tools ?? []).filter((t) => !t.readOnly),
    storeDataChanged: verdict?.storeDataChanged ?? false,
    agreement: verdict?.judge?.agreement ?? null,
    reasoning: verdict?.judge?.reasoning ?? null,
    passed: verdict?.passed ?? null,
    playbookId: verdict?.playbookId ?? null,
    conversationId: item.conversation_id,
    sourceConversationId: sourceConversationId(item.source_ref),
  };
}

export function buildReplayReport(run: SimulationRun, items: SimulationRunItem[]): ReplayReport {
  const judged = items.filter((i) => i.bucket && i.verdict);
  const agreement = { same: 0, partial: 0, different: 0 };
  for (const item of judged) {
    const value = item.verdict?.judge?.agreement;
    if (item.bucket === "answered" && value && value !== "no_reference") agreement[value]++;
  }
  return {
    run,
    sampleSize: judged.length,
    inProgress: items.filter((i) => i.status === "pending" || i.status === "running").length,
    notJudged: items.filter(
      (i) =>
        i.status === "failed" || i.status === "skipped" || (i.status === "completed" && !i.bucket),
    ).length,
    buckets: REPLAY_BUCKETS.map((bucket) => {
      const inBucket = judged.filter((i) => i.bucket === bucket);
      return {
        bucket,
        count: inBucket.length,
        examples: inBucket.slice(0, REPORT_EXAMPLES_PER_BUCKET).map(toReportExample),
      };
    }),
    agreement,
  };
}
