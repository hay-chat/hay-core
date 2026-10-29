import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { jwtSecondsLeft } from "../src/api";
import { resolvePluginId } from "../src/commands";
import { createProof, generateKeyPair } from "../src/dpop";
import {
  formatConversationHeader,
  formatMessage,
  normalizeMessage,
  repliesAfter,
  sortMessages,
} from "../src/format";

const msg = (id: string, type: string, createdAt: string, content = "", metadata = {}) =>
  normalizeMessage({ id, type, created_at: createdAt, content, metadata });

describe("repliesAfter", () => {
  const messages = sortMessages([
    msg("bot2", "BotAgent", "2026-10-29T10:00:05Z", "answer"),
    msg("greet", "BotAgent", "2026-10-29T09:59:00Z", "hello"),
    msg("mine", "Customer", "2026-10-29T10:00:00Z", "question"),
    msg("tool", "Tool", "2026-10-29T10:00:03Z"),
    msg("next", "Customer", "2026-10-29T10:00:06Z", "follow-up"),
  ]);

  it("returns non-customer messages after ours, never the greeting before it", () => {
    expect(repliesAfter(messages, "mine").map((m) => m.id)).toEqual(["tool", "bot2"]);
  });

  it("returns nothing when our message is not in the list yet", () => {
    expect(repliesAfter(messages, "missing")).toEqual([]);
  });
});

describe("formatMessage", () => {
  it("annotates bot replies with confidence and documents", () => {
    const line = formatMessage(
      msg("b", "BotAgent", "2026-10-29T13:58:42.000Z", "We ship in 2 days.", {
        confidence: 0.823,
        confidenceTier: "high",
        documentsUsed: [{ title: "Shipping policy", similarity: 0.81 }],
      }),
    );
    expect(line).toBe(
      "13:58:42 Bot: We ship in 2 days.  [conf 0.82 high; docs: Shipping policy(0.81)]",
    );
  });

  it("prints tool calls with status, latency and trimmed io", () => {
    const line = formatMessage(
      msg("t", "Tool", "2026-10-29T13:58:40.000Z", "", {
        toolName: "get_order",
        toolStatus: "SUCCESS",
        toolLatencyMs: 230,
        toolInput: { orderNumber: "1001" },
        toolOutput: { status: "shipped" },
      }),
    );
    expect(line).toBe(
      '13:58:40 Tool get_order SUCCESS 230ms in={"orderNumber":"1001"} out={"status":"shipped"}',
    );
  });

  it("indents multi-line content", () => {
    expect(formatMessage(msg("c", "Customer", "2026-10-29T13:58:40.000Z", "a\nb"))).toBe(
      "13:58:40 Customer: a\n    b",
    );
  });
});

describe("formatConversationHeader", () => {
  it("summarises the stored orchestrator state", () => {
    const lines = formatConversationHeader({
      id: "c1",
      status: "open",
      channel: "web",
      language: "en",
      title: "Opening hours",
      created_at: "2026-10-29T13:58:15.000Z",
      orchestration_status: {
        perception: { intent: { label: "question" } },
        rag: { query: "opening hours", results: [{ title: "Hours", sim: 0.9 }] },
        toolLog: [{ name: "get_order", ok: false, errorClass: "TIMEOUT", latencyMs: 30000 }],
      },
    });
    expect(lines).toContain('perception: {"intent":{"label":"question"}}');
    expect(lines).toContain('rag: query="opening hours" -> Hours(0.90)');
    expect(lines).toContain("tools: get_order:TIMEOUT(30000ms)");
  });
});

describe("resolvePluginId", () => {
  const plugins = [
    { id: "hay-plugin-shopify", name: "Shopify" },
    { id: "hay-plugin-stripe", name: "Stripe" },
    { id: "hay-channel-whatsapp-meta", name: "WhatsApp" },
  ];

  it("matches exact ids, names and id suffixes", () => {
    expect(resolvePluginId(plugins, "hay-plugin-stripe")).toBe("hay-plugin-stripe");
    expect(resolvePluginId(plugins, "shopify")).toBe("hay-plugin-shopify");
    expect(resolvePluginId(plugins, "WhatsApp")).toBe("hay-channel-whatsapp-meta");
  });

  it("refuses ambiguous or unknown names", () => {
    expect(() => resolvePluginId(plugins, "s")).toThrow(/Ambiguous/);
    expect(() => resolvePluginId(plugins, "zendesk")).toThrow(/No plugin/);
  });
});

describe("jwtSecondsLeft", () => {
  it("reads exp from the payload", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_000 })).toString("base64url");
    expect(jwtSecondsLeft(`h.${payload}.s`, 900_000)).toBe(100);
    expect(jwtSecondsLeft("not-a-jwt")).toBeNull();
  });
});

describe("DPoP proof", () => {
  it("is an ES256 dpop+jwt the public key verifies, with the claims the server checks", async () => {
    const keys = await generateKeyPair();
    const proof = await createProof(
      keys,
      "post",
      "https://x/v1/publicConversations.sendMessage",
      "n1",
    );
    const [h, p, s] = proof.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());

    expect(header).toEqual({ typ: "dpop+jwt", alg: "ES256", jwk: keys.publicJwk });
    expect(payload).toMatchObject({
      htm: "POST",
      htu: "https://x/v1/publicConversations.sendMessage",
      nonce: "n1",
    });
    expect(payload.jti).toMatch(/^[0-9a-f]{32}$/);

    const publicKey = await webcrypto.subtle.importKey(
      "jwk",
      keys.publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      Buffer.from(s, "base64url"),
      Buffer.from(`${h}.${p}`),
    );
    expect(valid).toBe(true);
  });
});
