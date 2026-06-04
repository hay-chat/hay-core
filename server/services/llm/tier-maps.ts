/**
 * Per-provider default tier → model maps.
 *
 * Call sites pick a task-complexity tier (easy|medium|hard); these maps translate
 * the tier to a concrete model for the selected provider. An org can override any
 * of these via its `OrgLlmConfig.chat.tiers` (Slice 5); these are the fallbacks.
 *
 * NOTE: gpt-4o stays the OpenAI `hard` default (it still works in production).
 * Non-OpenAI model ids are sensible 2026 defaults — verify against each provider's
 * live model list before relying on them, and prefer overriding per-org in config.
 *
 * @module services/llm/tier-maps
 */

import type { ChatProviderId, TierModelMap } from "./provider.types";

/** OpenAI-compatible default = OpenAI's own models (today's behavior, env-overridable). */
const OPENAI_COMPATIBLE_TIERS: TierModelMap = {
  hard: process.env.LLM_TIER_HARD || process.env.OPENAI_CHAT_MODEL || "gpt-4o",
  medium: process.env.LLM_TIER_MEDIUM || "gpt-4o-mini",
  easy: process.env.LLM_TIER_EASY || "gpt-4.1-nano",
};

const ANTHROPIC_TIERS: TierModelMap = {
  hard: "claude-opus-4-8",
  medium: "claude-sonnet-4-6",
  easy: "claude-haiku-4-5",
};

const GEMINI_TIERS: TierModelMap = {
  hard: "gemini-2.5-pro",
  medium: "gemini-2.5-flash",
  easy: "gemini-2.5-flash-lite",
};

export const PROVIDER_TIER_DEFAULTS: Record<ChatProviderId, TierModelMap> = {
  "openai-compatible": OPENAI_COMPATIBLE_TIERS,
  anthropic: ANTHROPIC_TIERS,
  gemini: GEMINI_TIERS,
};
