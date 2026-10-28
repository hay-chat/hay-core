import { describe, it, expect, afterEach } from "@jest/globals";
import { config as frozenConfig } from "@server/config/env";
import { describeAiProvider } from "@server/services/llm/ai-region";

// env.ts exports `as const`; the object itself is mutable.
type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
const config = frozenConfig as Mutable<typeof frozenConfig>;

/**
 * describeAiProvider (D14-5): the provider name an owner sees under Customer
 * Privacy -> AI processing must match the endpoint the factory picks.
 */

const original = {
  eu: config.aiRegion.eu.baseUrl,
  llm: config.llm.baseUrl,
  openai: config.openai.baseUrl,
};

afterEach(() => {
  config.aiRegion.eu.baseUrl = original.eu;
  config.llm.baseUrl = original.llm;
  config.openai.baseUrl = original.openai;
});

const tiers = { easy: "a", medium: "b", hard: "c" };
const embedding = { provider: "openai-compatible" as const, model: "text-embedding-3-small" };

describe("describeAiProvider", () => {
  it("names the EU endpoint for an EU org, even with a custom provider saved", () => {
    config.aiRegion.eu.baseUrl = "https://eu.api.openai.com/v1";
    expect(
      describeAiProvider({
        aiRegion: "eu",
        llm: { chat: { provider: "anthropic", tiers }, embedding },
      }),
    ).toEqual({ name: "OpenAI", host: "eu.api.openai.com" });
  });

  it("names the env default host when the org has no provider of its own", () => {
    config.llm.baseUrl = "https://inference.do-ai.run/v1";
    expect(describeAiProvider({})).toEqual({ name: "DigitalOcean", host: "inference.do-ai.run" });
    config.llm.baseUrl = "";
    config.openai.baseUrl = "";
    expect(describeAiProvider(null)).toEqual({ name: "OpenAI", host: "api.openai.com" });
  });

  it("names a custom provider, and shows an unknown host as is", () => {
    expect(
      describeAiProvider({ llm: { chat: { provider: "anthropic", tiers }, embedding } }),
    ).toEqual({ name: "Anthropic", host: "api.anthropic.com" });
    expect(
      describeAiProvider({
        llm: {
          chat: { provider: "openai-compatible", baseUrl: "https://llm.acme.test/v1", tiers },
          embedding,
        },
      }),
    ).toEqual({ name: "llm.acme.test", host: "llm.acme.test" });
  });
});
