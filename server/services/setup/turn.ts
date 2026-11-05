/**
 * The real test turn behind a Ready row.
 *
 * The cheap check (check.ts) is only a filter: it finds passages and asks one low-tier model call
 * whether they answer the question. The real chat then adds guardrails and may still hand the
 * conversation to the team. So a question the check calls answered gets one dry-run turn through
 * the orchestrator, using the simulation harness (invisible, never billed, delivered or alerted).
 * The run kind is `setup_check`, which the harness leaves out of the monthly simulation allowance.
 *
 * Cost per question: one embedding plus one low-tier call (the filter), and for a question that
 * passes the filter one orchestrator turn: measured 7-24k prompt tokens on the high tier plus
 * 16-27k on the low tier (about half cached), roughly $0.02 and up to $0.04 on gpt-4o and
 * gpt-4o-mini. Questions the filter rejects, platform questions and questions that already have
 * a result cost nothing here.
 *
 * Turns run one at a time per run (SIMULATION_CAPS.concurrencyPerRun), so a 30-question check
 * never takes more than one of the worker's two slots away from live shoppers.
 *
 * @module services/setup/turn
 */

import { AppDataSource } from "@server/database/data-source";
import { SimulationRunItem } from "@server/database/entities/simulation-run-item.entity";
import { SimulationRun } from "@server/database/entities/simulation-run.entity";
import { createLogger } from "@server/lib/logger";
import { simulationHarnessService } from "@server/services/simulation/simulation-harness.service";
import { SETUP_CHECK_RUN_KIND } from "@server/services/simulation/simulation-kind";
import { gatherTurnFacts } from "@server/services/simulation/turn-judge.service";
import type { SetupQuestion } from "@server/types/setup.types";
import { classifyTurn, turnRef, type PendingTurn, type TurnOutcome } from "./turn-classify";

const logger = createLogger("setup-turn");

/** A running turn this old is lost (queue message gone, worker crashed): it counts as failed. */
export const TURN_TIMEOUT_MS = 3 * 60 * 1000;
/** A turn still unresolved after this long is failed whatever the run says. */
export const TURN_HARD_LIMIT_MS = 30 * 60 * 1000;

/**
 * Starts one run with a case per question and returns each question's pending marker. Throws when
 * the run cannot start; callers record that as a failed check.
 */
export async function startTurns(
  organizationId: string,
  questions: Pick<SetupQuestion, "id" | "text">[],
  now: Date = new Date(),
): Promise<Map<string, PendingTurn>> {
  const started = new Map<string, PendingTurn>();
  if (questions.length === 0) return started;
  const run = await simulationHarnessService.startRun({
    organizationId,
    kind: SETUP_CHECK_RUN_KIND,
    label: "Setup check",
    cases: questions.map((q) => ({
      seed: [{ role: "customer", text: q.text }],
      sourceRef: turnRef(q),
    })),
  });
  for (const q of questions) {
    started.set(q.id, {
      state: "pending",
      runId: run.id,
      ref: turnRef(q),
      startedAt: now.toISOString(),
    });
  }
  return started;
}

/**
 * Where a pending turn stands. Never throws: anything unexpected is `failed`, and a lost turn
 * (running too long, run stopped, item missing) is failed here so no row waits forever.
 */
export async function readTurn(
  organizationId: string,
  turn: PendingTurn,
  now: Date = new Date(),
): Promise<TurnOutcome> {
  try {
    const age = now.getTime() - new Date(turn.startedAt).getTime();
    const item = await AppDataSource.getRepository(SimulationRunItem).findOne({
      where: { run_id: turn.runId, organization_id: organizationId, source_ref: turn.ref },
    });
    if (!item) return "failed";

    if (item.status === "completed") {
      if (!item.conversation_id) return "failed";
      return classifyTurn(await gatherTurnFacts(item.conversation_id));
    }
    if (item.status === "failed" || item.status === "skipped") return "failed";

    if (age > TURN_HARD_LIMIT_MS) {
      await simulationHarnessService.cancelRun(organizationId, turn.runId);
      return "failed";
    }
    if (item.status === "running" && item.started_at) {
      if (now.getTime() - new Date(item.started_at).getTime() > TURN_TIMEOUT_MS) {
        await simulationHarnessService.failRunningItem(item.id, "Timed out");
        return "failed";
      }
      return "pending";
    }
    // Queued behind earlier turns of its run: fine while the run is still going.
    const run = await AppDataSource.getRepository(SimulationRun).findOne({
      where: { id: turn.runId, organization_id: organizationId },
    });
    return run?.status === "running" ? "pending" : "failed";
  } catch (err) {
    logger.warn({ err, organizationId, runId: turn.runId }, "Reading a setup test turn failed");
    return "failed";
  }
}
