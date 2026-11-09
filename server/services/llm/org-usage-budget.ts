/**
 * Per-organization daily AI token budget, so one organization's traffic (or
 * someone abusing its widget) can't run up an unbounded provider bill. Usage
 * is counted from the LLM usage sink; the planner checks the total before each
 * call and hands off once it is spent. Redis being down lets calls through:
 * this limits cost and shouldn't take support offline.
 */

import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import { redisService } from "@server/services/redis.service";
import type { UsageEvent } from "./usage-sink";

const logger = createLogger("llm-budget");

const KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

function budgetKey(organizationId: string): string {
  return `llm:tokens:${organizationId}:${new Date().toISOString().slice(0, 10)}`;
}

export function recordOrgUsage(event: UsageEvent): void {
  const client = redisService.getClient();
  if (!event.organizationId || !client || !redisService.isConnected()) return;
  if (!(event.usage.totalTokens > 0)) return;
  const key = budgetKey(event.organizationId);
  client
    .multi()
    .incrby(key, Math.ceil(event.usage.totalTokens))
    .expire(key, KEY_TTL_SECONDS)
    .exec()
    .catch((err: unknown) => logger.warn({ err }, "Could not record AI token usage"));
}

export async function isOrgOverBudget(organizationId: string): Promise<boolean> {
  const budget = config.llm.orgDailyTokenBudget;
  const client = redisService.getClient();
  if (budget <= 0 || !client || !redisService.isConnected()) return false;
  try {
    return Number((await client.get(budgetKey(organizationId))) ?? 0) >= budget;
  } catch (err) {
    logger.warn({ err }, "Could not read AI token usage");
    return false;
  }
}
