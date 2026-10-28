import { describe, expect, it, vi } from "vitest";
import { deliver, threadingFromMessages } from "./deliver.js";
import { CONVERSATION_ID, fakeApi, fakeContext, settings } from "./test/fakes.js";

const messages = [
  {
    type: "Customer",
    providerMessageId: "<abc@shopper.com>",
    metadata: { mid: "<abc@shopper.com>", subject: "Where is my order?" },
  },
  { type: "BotAgent", providerMessageId: "<hay-m1@updates.hay.test>", metadata: {} },
  {
    type: "Customer",
    providerMessageId: "<def@shopper.com>",
    metadata: { mid: "<def@shopper.com>" },
  },
];

const payload = (overrides: Record<string, unknown> = {}) => ({
  to: "ana@shopper.com",
  content: "It shipped yesterday.\n\nTracking: 123",
  messageId: "m2",
  conversationId: CONVERSATION_ID,
  conversationMetadata: { email: { conversationId: "<abc@shopper.com>" } },
  attachments: [],
  ...overrides,
});

describe("threadingFromMessages", () => {
  it("replies to the last customer message, references the root and reuses the first subject", () => {
    expect(
      threadingFromMessages(messages, { email: { conversationId: "<abc@shopper.com>" } }),
    ).toEqual({
      inReplyTo: "<def@shopper.com>",
      references: ["<abc@shopper.com>", "<def@shopper.com>"],
      subject: "Where is my order?",
    });
  });
});

describe("deliver", () => {
  it("sends a threaded reply from the store name with a token Reply-To and our Message-ID", async () => {
    const api = fakeApi({ messages });
    const ctx = fakeContext({ api });

    const result = await deliver(payload(), ctx);

    expect(result).toEqual({
      status: 200,
      body: { success: true, providerMessageId: "<hay-m2@updates.hay.test>" },
    });
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]).toMatchObject({
      to: ["ana@shopper.com"],
      subject: "Re: Where is my order?",
      body: "It shipped yesterday.\n\nTracking: 123",
      from: { email: "support@updates.hay.test", name: "Acme Support" },
      replyTo: `in-abc123def4+c${CONVERSATION_ID}@inbound.hay.test`,
      messageId: "<hay-m2@updates.hay.test>",
      retry: false,
      headers: {
        "In-Reply-To": "<def@shopper.com>",
        References: "<abc@shopper.com> <def@shopper.com>",
        "X-Hay-Conversation": CONVERSATION_ID,
      },
    });
    expect(api.sent[0].bcc).toBeUndefined();
    expect(api.sent[0].html).toContain("<p>It shipped yesterday.</p>");
  });

  it("sends from the support address only once its domain is verified (D13-9)", async () => {
    const verified = fakeApi({ messages, sendingDomain: "acme.com" });
    await deliver(payload(), fakeContext({ api: verified }));
    expect(verified.sent[0].from).toEqual({ email: "support@acme.com", name: "Acme Support" });
    expect(verified.sent[0].messageId).toBe("<hay-m2@acme.com>");

    const otherDomain = fakeApi({ messages, sendingDomain: "other.com" });
    await deliver(payload(), fakeContext({ api: otherDomain }));
    expect(otherDomain.sent[0].from?.email).toBe("support@updates.hay.test");

    const none = fakeApi({ messages });
    await deliver(payload(), fakeContext({ api: none }));
    expect(none.sent[0].from?.email).toBe("support@updates.hay.test");
  });

  it("BCCs the support address when the archive option is on", async () => {
    const api = fakeApi({ messages });
    const ctx = fakeContext({ api, settings: { ...settings, bccArchive: true } });

    await deliver(payload(), ctx);

    expect(api.sent[0].bcc).toEqual(["support@acme.com"]);
  });

  it("attaches files from Hay storage", async () => {
    const api = fakeApi({ messages });
    const ctx = fakeContext({ api });
    const fetchImpl = vi.fn(
      async () => new Response("hello", { status: 200, headers: { "content-type": "text/plain" } }),
    ) as unknown as typeof fetch;

    await deliver(
      payload({
        attachments: [{ name: "a.txt", url: "https://cdn.hay.test/a.txt", type: "text/plain" }],
      }),
      ctx,
      { fetchImpl },
    );

    expect(api.sent[0].attachments).toEqual([
      {
        filename: "a.txt",
        contentBase64: Buffer.from("hello").toString("base64"),
        contentType: "text/plain",
      },
    ]);
  });

  it("reports a refused send as a failure, a failed history load as 503, and never retries a send that threw", async () => {
    const refused = fakeContext({
      api: fakeApi({ messages, sendResult: { success: false, error: "550 no" } }),
    });
    expect(await deliver(payload(), refused)).toEqual({
      status: 200,
      body: { success: false, error: "550 no" },
    });

    // The mail may have gone out before the call failed: a retry could send it twice.
    const down = fakeContext({ api: fakeApi({ messages, sendThrows: new Error("socket hang up") }) });
    expect(await deliver(payload(), down)).toEqual({
      status: 200,
      body: { success: false, error: "send_uncertain" },
    });

    const noHistory = fakeContext({ api: fakeApi({ queryThrows: new Error("timeout") }) });
    expect((await deliver(payload(), noHistory)).status).toBe(503);
  });

  it("rejects bad payloads and empty messages without sending", async () => {
    const api = fakeApi({ messages });
    const ctx = fakeContext({ api });
    expect((await deliver({ to: "x" }, ctx)).status).toBe(400);
    expect(await deliver(payload({ content: "  " }), ctx)).toEqual({
      status: 200,
      body: { success: false, error: "empty_message" },
    });
    expect(api.sent).toHaveLength(0);
    expect((await deliver(payload(), fakeContext({ settings: null }))).status).toBe(503);
  });
});
