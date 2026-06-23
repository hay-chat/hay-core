/**
 * Model catalog — the single source of truth for the model ids offered in the UI
 * and the per-provider default tier maps. Pure data (type-only imports) so it is
 * safe to import from BOTH the server (tier-maps.ts, factory) and the dashboard
 * (settings/llm.vue) without pulling in any server-only runtime.
 *
 * These lists are convenience presets only — the settings UI always offers a
 * "Custom…" escape, and any model id can be entered/stored. Verify ids against each
 * provider's live model list periodically; they drift as providers ship/retire models.
 *
 * @module services/llm/model-catalog
 */

import type { TierModelMap } from "./provider.types";

/** A user-facing model family = the dashboard provider choice minus "custom". */
export type ModelFamily = "openai" | "anthropic" | "gemini" | "mistral" | "grok";

/** Chat model presets per family (most → least capable, roughly). */
export const CHAT_MODEL_CATALOG: Record<ModelFamily, string[]> = {
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4-turbo",
    "gpt-4",
    "o3",
    "o3-pro",
    "o3-mini",
    "o4-mini",
    "o1",
    "o1-mini",
  ],
  anthropic: [
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-1",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-sonnet-4",
    "claude-haiku-4-5",
    "claude-3-7-sonnet-latest",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest",
  ],
  gemini: [
    "gemini-3-pro",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
  mistral: [
    "mistral-large-latest",
    "mistral-medium-latest",
    "mistral-small-latest",
    "ministral-8b-latest",
    "ministral-3b-latest",
    "magistral-medium-latest",
    "magistral-small-latest",
    "codestral-latest",
    "pixtral-large-latest",
    "open-mistral-nemo",
  ],
  grok: [
    "grok-4",
    "grok-4-fast-reasoning",
    "grok-4-fast-non-reasoning",
    "grok-3",
    "grok-3-fast",
    "grok-3-mini",
    "grok-3-mini-fast",
    "grok-2-1212",
    "grok-2-vision-1212",
  ],
};

/**
 * Managed embedding model presets. Embeddings are always OpenAI and pinned to 1536
 * dims (the factory asserts this) — text-embedding-3-large only fits when requested
 * at 1536 dimensions, which VectorStoreService already does.
 */
export const EMBEDDING_MODEL_CATALOG: string[] = [
  "text-embedding-3-small",
  "text-embedding-3-large",
  "text-embedding-ada-002",
];

/** Default tier → model map per family, used as the starting point in the UI/factory. */
export const DEFAULT_TIER_MAP: Record<ModelFamily, TierModelMap> = {
  openai: { hard: "gpt-4o", medium: "gpt-4o-mini", easy: "gpt-4.1-nano" },
  anthropic: { hard: "claude-opus-4-8", medium: "claude-sonnet-4-6", easy: "claude-haiku-4-5" },
  gemini: { hard: "gemini-2.5-pro", medium: "gemini-2.5-flash", easy: "gemini-2.5-flash-lite" },
  mistral: {
    hard: "mistral-large-latest",
    medium: "mistral-small-latest",
    easy: "ministral-3b-latest",
  },
  grok: { hard: "grok-4", medium: "grok-3", easy: "grok-3-mini" },
};
