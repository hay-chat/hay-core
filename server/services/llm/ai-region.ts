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
import type { OrgLlmConfig } from "./provider.types";

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

/** Display names for the AI hosts an owner is likely to see; anything else shows its host. */
const KNOWN_AI_HOSTS: Record<string, string> = {
  "api.openai.com": "OpenAI",
  "eu.api.openai.com": "OpenAI",
  "inference.do-ai.run": "DigitalOcean",
  "api.anthropic.com": "Anthropic",
  "generativelanguage.googleapis.com": "Google Gemini",
  "api.mistral.ai": "Mistral",
  "api.x.ai": "xAI",
};

function hostOf(url: string, fallback: string): string {
  if (!url) return fallback;
  try {
    return new URL(url).host;
  } catch {
    return fallback;
  }
}

/**
 * Who serves an org's AI chat calls, for display only (Settings -> Customer Privacy,
 * D14-5). Mirrors the endpoint the LLM provider factory picks; it never routes calls.
 */
export function describeAiProvider(
  settings: { aiRegion?: unknown; llm?: OrgLlmConfig } | null | undefined,
): { name: string; host: string } {
  let host: string;
  if (regionFromSettings(settings) === "eu") {
    host = hostOf(config.aiRegion.eu.baseUrl, "eu.api.openai.com");
  } else if (settings?.llm) {
    const { provider, baseUrl, apiKeyEncrypted } = settings.llm.chat;
    if (provider === "anthropic") host = hostOf(baseUrl ?? "", "api.anthropic.com");
    else if (provider === "gemini") host = "generativelanguage.googleapis.com";
    else if (baseUrl) host = hostOf(baseUrl, "api.openai.com");
    else host = apiKeyEncrypted ? "api.openai.com" : hostOf(config.openai.baseUrl, "api.openai.com");
  } else {
    host = hostOf(config.llm.baseUrl || config.openai.baseUrl, "api.openai.com");
  }
  return { name: KNOWN_AI_HOSTS[host] ?? host, host };
}
