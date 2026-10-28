import { describe, expect, it, vi } from "vitest";
import { deliver, splitText } from "./deliver.js";
import { GraphClient, type GraphTemplate } from "./graph-client.js";
import { TemplateStore } from "./templates.js";
import type { ChannelContext } from "./context.js";
import type { WhatsAppConnection } from "./connection.js";
import { fakeLogger, queuedFetch } from "./test/fakes.js";

const PHONE = "976350592236691";
const STORAGE = "https://cdn.hay.test/conversation-media";

const embedded: WhatsAppConnection = {
  mode: "embedded-signup",
  accessToken: "biz-token",
  phoneNumberId: PHONE,
  wabaId: "1234567890",
};

const accepted = (id: string): [number, unknown] => [200, { messages: [{ id }] }];
const uploaded = (id: string): [number, unknown] => [200, { id }];
const graphError = (status: number, code: number): [number, unknown] => [
  status,
  { error: { message: `error ${code}`, code } },
];

/** Hay storage fake: serves bytes per URL and records the request init. */
function storageFetch(files: Record<string, { status?: number; type: string; bytes?: number }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const file = files[String(url)];
    if (!file) {
      throw new Error("connection refused");
    }
    return new Response(new Uint8Array(file.bytes ?? 8), {
      status: file.status ?? 200,
      headers: { "content-type": file.type },
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function setup(
  responses: Array<[number, unknown]>,
  options: {
    connection?: WhatsAppConnection | null;
    files?: Record<string, { status?: number; type: string }>;
  } = {},
) {
  const graphFetch = queuedFetch(responses);
  const storage = storageFetch(options.files ?? {});
  const mutation = vi.fn(async () => ({ revoked: true }));
  const ctx: ChannelContext = {
    getConnection: () => (options.connection === undefined ? embedded : options.connection),
    graph: new GraphClient({ logger: fakeLogger(), fetchImpl: graphFetch.impl }),
    api: { mutation: mutation as ChannelContext["api"]["mutation"] },
    logger: fakeLogger(),
  };
  const run = (payload: unknown) => deliver(payload, ctx, { fetchImpl: storage.impl });
  return { run, ctx, graphCalls: graphFetch.calls, storageCalls: storage.calls, mutation };
}

/** setup() plus a synced template store (Graph's template list is stubbed, not fetched). */
async function setupWithTemplates(responses: Array<[number, unknown]>, templates: GraphTemplate[]) {
  const t = setup(responses);
  vi.spyOn(t.ctx.graph, "listTemplates").mockResolvedValue(templates);
  const store = new TemplateStore(t.ctx.graph, fakeLogger());
  await store.sync(embedded);
  t.ctx.templates = store;
  return t;
}

const approved = (
  name: string,
  language: string,
  text: string,
  extra: Partial<GraphTemplate> = {},
): GraphTemplate => ({
  id: `${name}-${language}`,
  name,
  language,
  status: "APPROVED",
  category: "UTILITY",
  components: [{ type: "BODY", text }],
  ...extra,
});

function jsonBody(call: { init?: RequestInit }): Record<string, unknown> {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

const attachment = (name: string, type: string) => ({
  id: name,
  name,
  url: `${STORAGE}/${name}`,
  type,
  size: 8,
});

describe("deliver", () => {
  it("sends plain text to an E.164 number", async () => {
    const { run, graphCalls } = setup([accepted("wamid.1")]);

    const result = await run({ to: "+5511999999999", content: "Hello!", messageId: "m1" });

    expect(result).toEqual({ status: 200, body: { success: true, providerMessageId: "wamid.1" } });
    expect(new URL(graphCalls[0].url).pathname).toBe(`/v26.0/${PHONE}/messages`);
    expect(jsonBody(graphCalls[0])).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+5511999999999",
      type: "text",
      text: { body: "Hello!", preview_url: true },
    });
  });

  it("addresses a BSUID customer with recipient", async () => {
    const { run, graphCalls } = setup([accepted("wamid.1")]);

    await run({ to: "whatsapp:bsuid:US.abc123", content: "Hi" });

    const body = jsonBody(graphCalls[0]);
    expect(body.recipient).toBe("US.abc123");
    expect(body.to).toBeUndefined();
  });

  it("splits text over 4096 chars and returns the first wamid", async () => {
    const paragraph = "a".repeat(3000);
    const { run, graphCalls } = setup([accepted("wamid.1"), accepted("wamid.2")]);

    const result = await run({ to: "+5511999999999", content: `${paragraph}\n\n${paragraph}` });

    expect(result.body).toEqual({ success: true, providerMessageId: "wamid.1" });
    const bodies = graphCalls.map((c) => (jsonBody(c).text as { body: string }).body);
    expect(bodies).toEqual([paragraph, paragraph]);
  });

  it("captions a single image instead of sending a separate text", async () => {
    const { run, graphCalls, storageCalls } = setup([uploaded("media.1"), accepted("wamid.1")], {
      files: { [`${STORAGE}/photo.jpg`]: { type: "image/jpeg" } },
    });

    const result = await run({
      to: "+5511999999999",
      content: "Here is your receipt",
      attachments: [attachment("photo.jpg", "image/jpeg")],
    });

    expect(result.body).toEqual({ success: true, providerMessageId: "wamid.1" });
    expect(graphCalls).toHaveLength(2);
    expect(new URL(graphCalls[0].url).pathname).toBe(`/v26.0/${PHONE}/media`);
    const form = graphCalls[0].init?.body as FormData;
    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(form.get("type")).toBe("image/jpeg");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(jsonBody(graphCalls[1])).toMatchObject({
      to: "+5511999999999",
      type: "image",
      image: { id: "media.1", caption: "Here is your receipt" },
    });
    // Hay storage is fetched without any credentials.
    expect(storageCalls).toHaveLength(1);
    expect(JSON.stringify(storageCalls[0].init ?? {})).not.toContain("Authorization");
    expect(JSON.stringify(storageCalls[0].init ?? {})).not.toContain("biz-token");
  });

  it("captions a single document and keeps its filename", async () => {
    const { run, graphCalls } = setup([uploaded("media.1"), accepted("wamid.1")], {
      files: { [`${STORAGE}/a.pdf`]: { type: "application/pdf" } },
    });

    const result = await run({
      to: "+5511999999999",
      content: "See attached",
      attachments: [attachment("a.pdf", "application/pdf")],
    });

    expect(result.body).toEqual({ success: true, providerMessageId: "wamid.1" });
    expect(graphCalls).toHaveLength(2);
    expect(jsonBody(graphCalls[1])).toMatchObject({
      type: "document",
      document: { id: "media.1", filename: "a.pdf", caption: "See attached" },
    });
  });

  it("sends text, then each attachment without caption when there are several", async () => {
    const { run, graphCalls } = setup(
      [
        accepted("wamid.1"),
        uploaded("media.1"),
        accepted("wamid.2"),
        uploaded("media.2"),
        accepted("wamid.3"),
      ],
      {
        files: {
          [`${STORAGE}/a.pdf`]: { type: "application/pdf" },
          [`${STORAGE}/b.png`]: { type: "image/png" },
        },
      },
    );

    const result = await run({
      to: "+5511999999999",
      content: "See attached",
      attachments: [attachment("a.pdf", "application/pdf"), attachment("b.png", "image/png")],
    });

    expect(result.body).toEqual({ success: true, providerMessageId: "wamid.1" });
    expect(jsonBody(graphCalls[0])).toMatchObject({ type: "text", text: { body: "See attached" } });
    expect(jsonBody(graphCalls[2])).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+5511999999999",
      type: "document",
      document: { id: "media.1", filename: "a.pdf" },
    });
    expect(jsonBody(graphCalls[4])).toMatchObject({ type: "image", image: { id: "media.2" } });
    expect((jsonBody(graphCalls[4]).image as Record<string, unknown>).caption).toBeUndefined();
  });

  it("sends text + document as two sends when the text is too long for a caption", async () => {
    const { run, graphCalls } = setup(
      [accepted("wamid.1"), uploaded("media.1"), accepted("wamid.2")],
      {
        files: { [`${STORAGE}/a.pdf`]: { type: "application/pdf" } },
      },
    );

    await run({
      to: "+5511999999999",
      content: "x".repeat(1500),
      attachments: [attachment("a.pdf", "application/pdf")],
    });

    expect(jsonBody(graphCalls[0]).type).toBe("text");
    expect(jsonBody(graphCalls[2])).toMatchObject({
      type: "document",
      document: { id: "media.1", filename: "a.pdf" },
    });
  });

  it("sends webp as a document", async () => {
    const { run, graphCalls } = setup([uploaded("media.1"), accepted("wamid.1")], {
      files: { [`${STORAGE}/sticker.webp`]: { type: "image/webp" } },
    });

    await run({
      to: "+5511999999999",
      content: "",
      attachments: [attachment("sticker.webp", "image/webp")],
    });

    expect(jsonBody(graphCalls[1])).toMatchObject({
      type: "document",
      document: { id: "media.1", filename: "sticker.webp" },
    });
  });

  it("maps 131047 to a 200 window error", async () => {
    const { run } = setup([graphError(400, 131047)]);

    expect(await run({ to: "+5511999999999", content: "Hi" })).toEqual({
      status: 200,
      body: { success: false, error: "24h_window_expired" },
    });
  });

  it.each([
    [131056, 400],
    [130429, 400],
  ])("maps rate limit %i to a retryable 503", async (code, status) => {
    const { run } = setup([graphError(status, code)]);

    expect(await run({ to: "+5511999999999", content: "Hi" })).toEqual({
      status: 503,
      body: { success: false, error: "rate_limited" },
    });
  });

  it("maps a network failure before the request reached Meta to a retryable 503", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
    const ctx: ChannelContext = {
      getConnection: () => embedded,
      graph: new GraphClient({
        logger: fakeLogger(),
        fetchImpl: vi.fn(async () => {
          throw refused;
        }) as unknown as typeof fetch,
      }),
      api: { mutation: vi.fn() as ChannelContext["api"]["mutation"] },
      logger: fakeLogger(),
    };

    expect(await deliver({ to: "+5511999999999", content: "Hi" }, ctx)).toEqual({
      status: 503,
      body: { success: false, error: "graph_unavailable" },
    });
  });

  it("never asks for a retry when the request may have reached Meta", async () => {
    const { run } = setup([]); // queuedFetch throws a plain error (e.g. a reset)

    expect(await run({ to: "+5511999999999", content: "Hi" })).toEqual({
      status: 200,
      body: { success: false, error: "delivery_uncertain" },
    });
  });

  it("retries a Meta 5xx refusal but not a bare gateway 5xx", async () => {
    expect(
      await setup([graphError(500, 131000)]).run({ to: "+5511999999999", content: "Hi" }),
    ).toEqual({ status: 503, body: { success: false, error: "graph_unavailable" } });
    expect(await setup([[504, undefined]]).run({ to: "+5511999999999", content: "Hi" })).toEqual({
      status: 200,
      body: { success: false, error: "delivery_uncertain" },
    });
  });

  it("revokes an Embedded Signup connection on 190", async () => {
    const { run, mutation } = setup([graphError(401, 190)]);

    expect(await run({ to: "+5511999999999", content: "Hi" })).toEqual({
      status: 200,
      body: { success: false, error: "token_revoked" },
    });
    expect(mutation).toHaveBeenCalledWith("connection.revoke", { reason: "graph_190" });
  });

  it("does not revoke a manual connection on 190", async () => {
    const { run, mutation } = setup([graphError(401, 190)], {
      connection: { ...embedded, mode: "manual" },
    });

    expect((await run({ to: "+5511999999999", content: "Hi" })).body.error).toBe("token_revoked");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("maps 133010 to phone_not_registered", async () => {
    const { run } = setup([graphError(400, 133010)]);

    expect((await run({ to: "+5511999999999", content: "Hi" })).body).toEqual({
      success: false,
      error: "phone_not_registered",
    });
  });

  it("maps other 4xx errors to graph_<code>", async () => {
    const { run } = setup([graphError(400, 100)]);

    expect(await run({ to: "+5511999999999", content: "Hi" })).toEqual({
      status: 200,
      body: { success: false, error: "graph_100" },
    });
  });

  it("reports success when an attachment fails after the text went out", async () => {
    const { run, mutation } = setup([accepted("wamid.1"), graphError(401, 190)], {
      files: {
        [`${STORAGE}/a.pdf`]: { type: "application/pdf" },
        [`${STORAGE}/b.pdf`]: { type: "application/pdf" },
      },
    });

    const result = await run({
      to: "+5511999999999",
      content: "See attached",
      attachments: [attachment("a.pdf", "application/pdf"), attachment("b.pdf", "application/pdf")],
    });

    expect(result).toEqual({ status: 200, body: { success: true, providerMessageId: "wamid.1" } });
    expect(mutation).toHaveBeenCalledWith("connection.revoke", { reason: "graph_190" });
  });

  it("returns 503 when the channel is not connected", async () => {
    const { run } = setup([], { connection: null });

    expect(await run({ to: "+5511999999999", content: "Hi" })).toEqual({
      status: 503,
      body: { success: false, error: "Plugin not fully configured" },
    });
  });

  it.each([
    [null],
    [{ content: "Hi" }],
    [{ to: "+5511999999999", content: "  " }],
    [{ to: "+5511999999999", content: "Hi", attachments: "nope" }],
    [{ to: "+5511999999999", content: "Hi", attachments: [{ name: "x" }] }],
  ])("rejects an invalid payload with 400 (%#)", async (payload) => {
    const { run, graphCalls } = setup([]);

    expect((await run(payload)).status).toBe(400);
    expect(graphCalls).toHaveLength(0);
  });

  it("returns attachment_unavailable when the only attachment cannot be downloaded", async () => {
    const { run, graphCalls } = setup([], {
      files: { [`${STORAGE}/a.pdf`]: { status: 404, type: "text/plain" } },
    });

    expect(
      await run({
        to: "+5511999999999",
        content: "",
        attachments: [attachment("a.pdf", "application/pdf")],
      }),
    ).toEqual({ status: 200, body: { success: false, error: "attachment_unavailable" } });
    expect(graphCalls).toHaveLength(0);
  });

  it("falls back to plain text when a captioned attachment cannot be downloaded", async () => {
    const { run, graphCalls } = setup([accepted("wamid.1")]);

    const result = await run({
      to: "+5511999999999",
      content: "Here you go",
      attachments: [attachment("missing.jpg", "image/jpeg")],
    });

    expect(result.body).toEqual({ success: true, providerMessageId: "wamid.1" });
    expect(jsonBody(graphCalls[0])).toMatchObject({ type: "text", text: { body: "Here you go" } });
  });
});

describe("deliver — templates (D13-3, D13-4)", () => {
  const handoffTemplates = [
    approved("hay_handoff_to_person", "en", "A person will reply."),
    approved("hay_handoff_to_person", "pt_BR", "Uma pessoa vai responder."),
  ];

  it("sends a human-picked template with positional body parameters", async () => {
    const { run, graphCalls } = await setupWithTemplates(
      [accepted("wamid.t")],
      [approved("order_update", "en", "Hi {{1}}, order {{2}}")],
    );

    const result = await run({
      to: "+5511999999999",
      content: "Hi Ana, order 42",
      messageMetadata: {
        channelTemplate: {
          name: "order_update",
          language: "en",
          parameters: [
            { name: "1", value: "Ana" },
            { name: "2", value: "42" },
          ],
        },
      },
    });

    expect(result).toEqual({ status: 200, body: { success: true, providerMessageId: "wamid.t" } });
    expect(graphCalls).toHaveLength(1);
    expect(jsonBody(graphCalls[0])).toMatchObject({
      type: "template",
      template: {
        name: "order_update",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Ana" },
              { type: "text", text: "42" },
            ],
          },
        ],
      },
    });
  });

  it("labels named parameters", async () => {
    const { run, graphCalls } = await setupWithTemplates(
      [accepted("wamid.t")],
      [approved("greet", "en", "Hi {{first_name}}", { parameter_format: "NAMED" })],
    );

    await run({
      to: "+5511999999999",
      content: "Hi Ana",
      messageMetadata: {
        channelTemplate: {
          name: "greet",
          language: "en",
          parameters: [{ name: "first_name", value: "Ana" }],
        },
      },
    });

    expect(jsonBody(graphCalls[0])).toMatchObject({
      template: {
        components: [
          {
            type: "body",
            parameters: [{ type: "text", parameter_name: "first_name", text: "Ana" }],
          },
        ],
      },
    });
  });

  it("maps a refused template like any other send", async () => {
    const { run } = await setupWithTemplates([graphError(400, 132001)], []);

    const result = await run({
      to: "+5511999999999",
      content: "x",
      messageMetadata: { channelTemplate: { name: "gone", language: "en", parameters: [] } },
    });

    expect(result).toEqual({ status: 200, body: { success: false, error: "graph_132001" } });
  });

  it("sends the hand-off template in the conversation's language when the window is closed", async () => {
    const { run, graphCalls } = await setupWithTemplates(
      [graphError(400, 131047), accepted("wamid.h")],
      handoffTemplates,
    );

    const result = await run({
      to: "+5511999999999",
      content: "Vou passar você para a equipe.",
      language: "pt",
      messageMetadata: { isHandoffMessage: true },
    });

    expect(result).toEqual({ status: 200, body: { success: true, providerMessageId: "wamid.h" } });
    expect(jsonBody(graphCalls[1])).toMatchObject({
      type: "template",
      template: { name: "hay_handoff_to_person", language: { code: "pt_BR" } },
    });
  });

  it("keeps the window error for a non-hand-off message", async () => {
    const { run, graphCalls } = await setupWithTemplates(
      [graphError(400, 131047)],
      handoffTemplates,
    );

    const result = await run({ to: "+5511999999999", content: "Anything else?" });

    expect(result).toEqual({ status: 200, body: { success: false, error: "24h_window_expired" } });
    expect(graphCalls).toHaveLength(1);
  });

  it("keeps the window error when no hand-off template is approved", async () => {
    const { run } = await setupWithTemplates(
      [graphError(400, 131047)],
      [approved("hay_handoff_to_person", "en", "x", { status: "PENDING" })],
    );

    const result = await run({
      to: "+5511999999999",
      content: "Handing off",
      messageMetadata: { isHandoffMessage: true },
    });

    expect(result).toEqual({ status: 200, body: { success: false, error: "24h_window_expired" } });
  });
});

describe("splitText", () => {
  it("prefers line, then word boundaries, and never exceeds the limit", () => {
    expect(splitText("one two three", 8)).toEqual(["one two", "three"]);
    expect(splitText("aaaa\nbb cc", 8)).toEqual(["aaaa", "bb cc"]);
    expect(splitText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });
});
