/**
 * AI processing region.
 *
 * An organization opts in to `aiRegion: "eu"` to have every LLM, embedding and
 * transcription call served by the EU endpoint (OpenAI EU data residency project,
 * configured with OPENAI_EU_BASE_URL + OPENAI_EU_API_KEY). Everything else stays on
 * "default", which is whatever the env default bundle points at.
 *
 * Fail-safe rule: an EU org's data never goes to a non-EU endpoint. When the EU
 * endpoint is not configured, the factory throws `AiRegionUnavailableError`
 * instead of falling back, and the settings route refuses to turn EU on.
 *
 * @module services/llm/ai-region
 */

import { config } from "@server/config/env";

export const AI_REGIONS = ["default", "eu"] as const;
export type AiRegion = (typeof AI_REGIONS)[number];

/** True when the EU endpoint has both a base URL and a key. */
export function isEuRegionConfigured(): boolean {
  return Boolean(config.aiRegion.eu.baseUrl && config.aiRegion.eu.apiKey);
}

/** Read an org's region from its settings JSONB; anything unknown is "default". */
export function regionFromSettings(settings: { aiRegion?: unknown } | null | undefined): AiRegion {
  return settings?.aiRegion === "eu" ? "eu" : "default";
}

/**
 * Thrown when an org requires EU processing but the EU endpoint is not configured.
 * Callers treat it like any provider failure; it is never retried against another region.
 */
export class AiRegionUnavailableError extends Error {
  constructor(
    public readonly organizationId: string,
    public readonly region: AiRegion,
  ) {
    super(
      `Organization ${organizationId} requires AI processing in region "${region}", ` +
        `but that region is not configured (set OPENAI_EU_BASE_URL and OPENAI_EU_API_KEY). ` +
        `Refusing to fall back to another region.`,
    );
    this.name = "AiRegionUnavailableError";
  }
}
