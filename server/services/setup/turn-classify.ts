/**
 * Pure parts of the setup test turn: the reference that ties a turn to one question, and how a
 * finished turn is judged. Kept apart from turn.ts so they need no database to test.
 *
 * @module services/setup/turn-classify
 */

import { createHash } from "node:crypto";
import type { SetupQuestion, SetupTurn } from "@server/types/setup.types";

export type TurnOutcome = "passed" | "handed_off" | "failed" | "pending";
export type PendingTurn = Extract<SetupTurn, { state: "pending" }>;

/** Stable per question id and wording, so an edited question never picks up an old turn. */
export function turnRef(question: Pick<SetupQuestion, "id" | "text">): string {
  const hash = createHash("sha1").update(question.text).digest("hex").slice(0, 12);
  return `setup:${question.id}:${hash}`;
}

/** A bot reply with no hand-off passes; a hand-off does not; no reply at all is a failure. */
export function classifyTurn(facts: { reply: string | null; handedOff: boolean }): TurnOutcome {
  if (facts.handedOff) return "handed_off";
  return facts.reply?.trim() ? "passed" : "failed";
}
