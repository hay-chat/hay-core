/**
 * Estimated LLM cost for the Insights ledger (D3-11). USD per 1M tokens,
 * list prices, no volume or batch discounts. A model that is not listed
 * gets a null cost (tracked, never guessed).
 *
 * Sources (verify when a provider changes prices):
 * - Anthropic: Claude API list prices, cache reads at 0.1x input (2026-10).
 * - OpenAI: public pricing page as last known; not re-verified in D3-11.
 * - Gemini, Mistral, Grok defaults: not priced yet (null cost).
 * TODO: move to the model catalog once metering (HAY-251) needs prices too.
 */
import type { UsageRecord } from "@server/services/llm/provider.types";

interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
}

const PRICES_PER_MILLION: Record<string, ModelPrice> = {
  // Anthropic
  "claude-haiku-4-5": { input: 1, cachedInput: 0.1, output: 5 },
  "claude-sonnet-4-6": { input: 3, cachedInput: 0.3, output: 15 },
  "claude-opus-4-8": { input: 5, cachedInput: 0.5, output: 25 },
  // OpenAI
  "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 },
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "text-embedding-3-small": { input: 0.02, cachedInput: 0.02, output: 0 },
};

/** Providers report dated ids ("gpt-4o-mini-2024-07-18"); match the longest listed prefix. */
function priceFor(model: string): ModelPrice | null {
  const id = model.toLowerCase();
  let best: string | null = null;
  for (const key of Object.keys(PRICES_PER_MILLION)) {
    if ((id === key || id.startsWith(`${key}-`)) && (!best || key.length > best.length)) {
      best = key;
    }
  }
  return best ? PRICES_PER_MILLION[best] : null;
}

export type TokenUsage = Pick<
  UsageRecord,
  "promptTokens" | "cachedPromptTokens" | "completionTokens"
>;

/** Estimated USD cost, or null when the model has no listed price. */
export function estimateCostUsd(model: string | null, usage: TokenUsage | null): number | null {
  if (!model || !usage) return null;
  const price = priceFor(model);
  if (!price) return null;
  const cached = Math.min(usage.cachedPromptTokens || 0, usage.promptTokens || 0);
  const uncached = (usage.promptTokens || 0) - cached;
  const cost =
    (uncached * price.input +
      cached * price.cachedInput +
      (usage.completionTokens || 0) * price.output) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
