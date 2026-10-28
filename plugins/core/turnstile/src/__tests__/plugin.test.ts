/**
 * Registration contract: the contribution exposes only public config (never
 * the secret) and the gate is fail-open, reading its settings from org config.
 */
import { describe, it, expect, vi } from "vitest";
import plugin from "../index.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

async function initialize() {
  const contribution = vi.fn();
  const gate = vi.fn();
  const config = vi.fn();
  const definition = plugin({ logger: silent } as never);
  await definition.onInitialize!({
    register: { config, webchat: { contribution, gate } },
    config: { field: (name: string) => ({ name }) },
    logger: silent,
  } as never);
  return { contribution, gate, config };
}

describe("turnstile plugin registration", () => {
  it("contributes a challenge@1 backed by public config only", async () => {
    const { contribution, config } = await initialize();
    expect(contribution).toHaveBeenCalledWith({
      id: "challenge",
      type: "challenge@1",
      props: {
        provider: "turnstile",
        siteKey: { name: "siteKey" },
        mode: { name: "mode" },
        action: "conversation_create",
      },
    });
    const schema = config.mock.calls[0][0];
    expect(schema.secretKey).toMatchObject({ encrypted: true, env: "TURNSTILE_SECRET_KEY" });
    expect(schema.siteKey.encrypted).toBeFalsy();
    expect(schema.mode.default).toBe("invisible");
  });

  it("registers a fail-open conversation.create gate that reads org config", async () => {
    const { gate } = await initialize();
    const [event, handler, options] = gate.mock.calls[0];
    expect(event).toBe("conversation.create");
    expect(options).toEqual({ timeoutMs: 4000, failurePolicy: "open" });

    const values: Record<string, string> = { siteKey: "k", secretKey: "s", mode: "challenge_all" };
    const result = await handler(
      { config: { getOptional: (key: string) => values[key] }, logger: silent },
      { event: "conversation.create", frameHostname: "api.hay.chat", underAttack: false },
    );
    expect(result).toEqual({ decision: "deny", reason: "token_missing" });
  });
});
