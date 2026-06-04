/**
 * LLM usage seam.
 *
 * Every chat + embedding call emits a normalized usage event here. Today nothing
 * is registered (managed metering is a separate, deferred effort — see
 * tasks/managed-llm-metering-design.md / PR #43); this is the single hook that lets
 * metering bolt on later WITHOUT re-touching the ~12 call sites. A sink must never
 * throw into the caller, so `emitUsage` swallows sink errors.
 *
 * @module services/llm/usage-sink
 */

import { createLogger } from "@server/lib/logger";
import type { ModelTier, UsageRecord } from "./provider.types";

const logger = createLogger("llm-usage");

export interface UsageEvent {
  kind: "chat" | "embedding";
  usage: UsageRecord;
  model: string;
  provider: string;
  organizationId?: string;
  tier?: ModelTier;
}

export type UsageSink = (event: UsageEvent) => void;

let sink: UsageSink | undefined;

/** Register (or clear, with `undefined`) the process-wide usage sink. */
export function setUsageSink(fn: UsageSink | undefined): void {
  sink = fn;
}

/** Emit a usage event to the registered sink. Never throws into the caller. */
export function emitUsage(event: UsageEvent): void {
  if (!sink) return;
  try {
    sink(event);
  } catch (err) {
    logger.warn({ err }, "Usage sink threw; ignoring");
  }
}
