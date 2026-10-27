/**
 * Per-provider default tier → model maps used by the factory when an org hasn't
 * configured its own. Sourced from the shared model catalog (single source of truth);
 * OpenAI-compatible defaults additionally honor env overrides.
 *
 * @module services/llm/tier-maps
 */

import { DEFAULT_TIER_MAP } from "./model-catalog";
import type { ChatProviderId, TierModelMap } from "./provider.types";

/** OpenAI-compatible default = OpenAI's catalog defaults, env-overridable. */
const OPENAI_COMPATIBLE_TIERS: TierModelMap = {
  hard: process.env.LLM_TIER_HARD || process.env.OPENAI_CHAT_MODEL || DEFAULT_TIER_MAP.openai.hard,
  medium: process.env.LLM_TIER_MEDIUM || DEFAULT_TIER_MAP.openai.medium,
  easy: process.env.LLM_TIER_EASY || DEFAULT_TIER_MAP.openai.easy,
};

/**
 * Tiers for the managed EU bundle. Deliberately NOT LLM_TIER_*: those name models
 * on the default host (e.g. DeepSeek on DO Gradient) that do not exist on OpenAI EU.
 */
export const EU_TIERS: TierModelMap = {
  hard: process.env.OPENAI_EU_TIER_HARD || DEFAULT_TIER_MAP.openai.hard,
  medium: process.env.OPENAI_EU_TIER_MEDIUM || DEFAULT_TIER_MAP.openai.medium,
  easy: process.env.OPENAI_EU_TIER_EASY || DEFAULT_TIER_MAP.openai.easy,
};

export const PROVIDER_TIER_DEFAULTS: Record<ChatProviderId, TierModelMap> = {
  "openai-compatible": OPENAI_COMPATIBLE_TIERS,
  anthropic: DEFAULT_TIER_MAP.anthropic,
  gemini: DEFAULT_TIER_MAP.gemini,
};
