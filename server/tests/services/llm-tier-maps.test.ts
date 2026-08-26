import { describe, it, expect, afterEach } from "@jest/globals";
import { DEFAULT_TIER_MAP } from "../../services/llm/model-catalog";

/**
 * The openai-compatible tier map is resolved from process.env at module load.
 * That made assertions elsewhere pass locally (where a developer .env sets
 * OPENAI_CHAT_MODEL=gpt-4o) and fail in CI, where no .env exists and the catalog
 * default applies. These tests pin the resolution order explicitly instead of
 * inheriting whatever the ambient environment happens to be.
 */
const ENV_KEYS = ["LLM_TIER_HARD", "LLM_TIER_MEDIUM", "LLM_TIER_EASY", "OPENAI_CHAT_MODEL"];

describe("openai-compatible tier defaults", () => {
  const original = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const [key, value] of original) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    jest.resetModules();
  });

  /** Load tier-maps fresh under an explicit environment. */
  const loadTiers = async (env: Record<string, string | undefined>) => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
    jest.resetModules();
    const { PROVIDER_TIER_DEFAULTS } = await import("../../services/llm/tier-maps");
    return PROVIDER_TIER_DEFAULTS["openai-compatible"];
  };

  it("falls back to the catalog defaults when nothing is configured", async () => {
    const tiers = await loadTiers({});

    expect(tiers).toEqual(DEFAULT_TIER_MAP.openai);
    expect(tiers.hard).toBe("gpt-4.1");
  });

  it("lets OPENAI_CHAT_MODEL override the hard tier only", async () => {
    const tiers = await loadTiers({ OPENAI_CHAT_MODEL: "gpt-4o" });

    expect(tiers.hard).toBe("gpt-4o");
    expect(tiers.medium).toBe(DEFAULT_TIER_MAP.openai.medium);
    expect(tiers.easy).toBe(DEFAULT_TIER_MAP.openai.easy);
  });

  it("prefers LLM_TIER_HARD over OPENAI_CHAT_MODEL", async () => {
    const tiers = await loadTiers({
      LLM_TIER_HARD: "deepseek-3.2",
      OPENAI_CHAT_MODEL: "gpt-4o",
    });

    expect(tiers.hard).toBe("deepseek-3.2");
  });

  it("allows each tier to be set independently", async () => {
    const tiers = await loadTiers({
      LLM_TIER_HARD: "a",
      LLM_TIER_MEDIUM: "b",
      LLM_TIER_EASY: "c",
    });

    expect(tiers).toEqual({ hard: "a", medium: "b", easy: "c" });
  });

  it("leaves non-openai providers on their catalog defaults", async () => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    process.env["OPENAI_CHAT_MODEL"] = "gpt-4o";
    jest.resetModules();
    const { PROVIDER_TIER_DEFAULTS } = await import("../../services/llm/tier-maps");

    expect(PROVIDER_TIER_DEFAULTS.anthropic).toEqual(DEFAULT_TIER_MAP.anthropic);
    expect(PROVIDER_TIER_DEFAULTS.gemini).toEqual(DEFAULT_TIER_MAP.gemini);
  });
});
