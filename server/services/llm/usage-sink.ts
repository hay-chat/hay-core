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

import { AsyncLocalStorage } from "node:async_hooks";
import { createLogger } from "@server/lib/logger";
import type { ModelTier, UsageRecord } from "./provider.types";
import type { AiRegion } from "./ai-region";

const logger = createLogger("llm-usage");

export interface UsageEvent {
  /** "vision" = customer photo/PDF pass (D8-11); "transcription" = voice notes (D8-5). */
  kind: "chat" | "embedding" | "vision" | "transcription";
  usage: UsageRecord;
  model: string;
  provider: string;
  organizationId?: string;
  tier?: ModelTier;
  /** Region of the endpoint that served the call. */
  region?: AiRegion;
}

export type UsageSink = (event: UsageEvent) => void;

let sink: UsageSink | undefined;

/** Register (or clear, with `undefined`) the process-wide usage sink. */
export function setUsageSink(fn: UsageSink | undefined): void {
  sink = fn;
}

const collectors = new AsyncLocalStorage<UsageSink>();

/**
 * Run `fn` with `collector` also receiving every usage event emitted inside it
 * (its awaited calls included), next to the process-wide sink. Used to cost
 * one piece of work, such as a simulated conversation (D7-7).
 */
export function withUsageCollector<T>(collector: UsageSink, fn: () => Promise<T>): Promise<T> {
  return collectors.run(collector, fn);
}

/** Emit a usage event to the registered sink. Never throws into the caller. */
export function emitUsage(event: UsageEvent): void {
  const collector = collectors.getStore();
  for (const target of [sink, collector]) {
    if (!target) continue;
    try {
      target(event);
    } catch (err) {
      logger.warn({ err }, "Usage sink threw; ignoring");
    }
  }
}
