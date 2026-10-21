import { describe, expect, it, vi } from "vitest";
import { GraphApiError, GraphClient } from "./graph-client.js";
import { handleWebhook } from "./webhook.js";
import type { ChannelContext } from "./context.js";
import type { ConnectionMode, WhatsAppConnection } from "./connection.js";
import { fakeLogger } from "./test/fakes.js";
import * as p from "./test/payloads.js";

type Input = Record<string, unknown>;

const upload = {
  id: "up-1",
  name: "file",
  url: "https://cdn.hay.test/file",
  type: "image/jpeg",
  size: 3,
};

function setup(
  options: {
    mode?: ConnectionMode;
    transcript?: string;
    handler?: (procedure: string, input: Input) => Promise<unknown>;
  } = {},
) {
  const connection: WhatsAppConnection = {
    mode: options.mode ?? "embedded-signup",
    accessToken: "biz-token",
    phoneNumberId: p.PHONE_NUMBER_ID,
    wabaId: p.WABA_ID,
  };
  const graph = new GraphClient({
    logger: fakeLogger(),
    fetchImpl: vi.fn() as unknown as typeof fetch,
  });
  const getMedia = vi.spyOn(graph, "getMedia").mockImplementation(async (id) => ({
    id,
    url: `https://lookaside.test/${id}`,
    mime_type: "image/jpeg",
  }));
  vi.spyOn(graph, "downloadMedia").mockResolvedValue(Buffer.from("abc"));

  const mutation = vi.fn(async (procedure: string, input: Input): Promise<unknown> => {
    if (options.handler) {
      return options.handler(procedure, input);
    }
    if (procedure === "media.upload") {
      return options.transcript ? { ...upload, transcript: options.transcript } : upload;
    }
    return { messageId: "msg-1", conversationId: "conv-1" };
  });

  const ctx: ChannelContext = {
    getConnection: () => connection,
    graph,
    api: { mutation: mutation as unknown as ChannelContext["api"]["mutation"] },
    logger: fakeLogger(),
  };

  /** Inputs of every call to one procedure. */
  const calls = (procedure: string) =>
    mutation.mock.calls.filter(([name]) => name === procedure).map(([, input]) => input);
  return { ctx, mutation, calls, getMedia };
}

async function receiveOne(message: Record<string, unknown>, contacts?: Record<string, unknown>[]) {
  const t = setup();
  const summary = await handleWebhook(p.envelope(p.inboundChange(message, contacts)), t.ctx);
  return { summary, input: t.calls("messages.receive")[0], t };
}

describe("handleWebhook — inbound messages", () => {
  it("forwards text with the customer identity and dedupe metadata", async () => {
    const message = p.textMessage();
    const { summary, input } = await receiveOne(message);

    expect(summary).toEqual({ processed: 1, ignored: 0, statuses: 0 });
    expect(input).toEqual({
      from: `+${p.WA_ID}`,
      content: "Hi, is my order shipped?",
      channel: "whatsapp",
      senderType: "customer",
      metadata: {
        mid: message.id,
        profileName: "Ana",
        phone: `+${p.WA_ID}`,
        waId: p.WA_ID,
        userId: p.BSUID,
        phoneNumberId: p.PHONE_NUMBER_ID,
        timestamp: "1760000000",
        type: "text",
      },
    });
  });

  it("keys a username-only sender by BSUID, without a phone", async () => {
    const message = { ...p.textMessage(), from: undefined };
    const { input } = await receiveOne(message, [{ profile: { name: "Ana" }, user_id: p.BSUID }]);

    expect(input.from).toBe(`whatsapp:bsuid:${p.BSUID}`);
    expect(input.metadata).toMatchObject({ userId: p.BSUID, profileName: "Ana" });
    expect(input.metadata).not.toHaveProperty("phone");
    expect(input.metadata).not.toHaveProperty("waId");
  });

  it("ignores a message with neither wa_id nor user_id", async () => {
    const message = { ...p.textMessage(), from: undefined, from_user_id: undefined };
    const { summary, t } = await receiveOne(message, []);

    expect(summary).toEqual({ processed: 0, ignored: 1, statuses: 0 });
    expect(t.mutation).not.toHaveBeenCalled();
  });

  it("uses the button title as content and keeps the id + replied-to wamid", async () => {
    const { input } = await receiveOne(p.buttonReply);

    expect(input.content).toBe("Track my order");
    expect(input.metadata).toMatchObject({
      interactive: { type: "button_reply", id: "track-order", title: "Track my order" },
      context: { replyTo: "wamid.OUTBOUND1" },
    });
  });

  it("uses the list row title and keeps its description", async () => {
    const { input } = await receiveOne(p.listReply);

    expect(input.content).toBe("Medium");
    expect(input.metadata).toMatchObject({
      interactive: { type: "list_reply", id: "size-m", title: "Medium", description: "Fits 38-40" },
    });
  });

  it("forwards a Flow submission with its response JSON", async () => {
    const { input } = await receiveOne(p.flowReply);

    expect(input.content).toBe("Sent");
    expect(input.metadata).toMatchObject({
      interactive: {
        type: "nfm_reply",
        responseJson: '{"flow_token":"t1","email":"ana@example.com"}',
      },
    });
  });

  it("forwards a template quick-reply button", async () => {
    const { input } = await receiveOne(p.templateButton);

    expect(input.content).toBe("Stop promotions");
    expect(input.metadata).toMatchObject({
      button: { payload: "STOP_PROMOS", text: "Stop promotions" },
    });
  });

  it("describes a location on one line", async () => {
    const { input } = await receiveOne(p.locationMessage);

    expect(input.content).toBe(
      "Location: Loja Centro — Praça da Sé, São Paulo (-23.5505, -46.6333) https://maps.google.com/?q=-23.5505,-46.6333",
    );
    expect(input.metadata).toMatchObject({ location: { latitude: -23.5505 } });
  });

  it("describes shared contact cards, one per line", async () => {
    const { input } = await receiveOne(p.contactsMessage);

    expect(input.content).toBe(
      "Shared contact: Bruno Lima +55 11 98888-7777\nShared contact: Carla",
    );
  });

  it("summarises an order and keeps the raw order", async () => {
    const { input } = await receiveOne(p.orderMessage);

    expect(input.content).toBe("Order: 3 items (SKU-1, SKU-2) — total 25 BRL\nGift wrap please");
    expect(input.metadata).toMatchObject({ order: { catalog_id: "cat-1" } });
  });

  it("treats request_welcome as a greeting", async () => {
    const { input } = await receiveOne(p.requestWelcome);

    expect(input.content).toBe("Hello");
  });

  it("keeps reply context and the click-to-WhatsApp referral", async () => {
    const { input } = await receiveOne(p.referralText);

    expect(input.metadata).toMatchObject({
      context: { forwarded: true },
      referral: { source_id: "ad-123", ctwa_clid: "clid-xyz", headline: "50% off" },
    });
  });

  it.each([
    ["reaction", p.reaction],
    ["system", p.systemMessage],
    ["unsupported", p.unsupported],
    ["unknown", p.inbound({ type: "poll_vote" })],
    ["empty text", p.textMessage("   ")],
  ])("ignores %s messages", async (_label, message) => {
    const { summary, t } = await receiveOne(message);

    expect(summary).toEqual({ processed: 0, ignored: 1, statuses: 0 });
    expect(t.mutation).not.toHaveBeenCalled();
  });

  it("processes every entry and change, skipping another phone number's change", async () => {
    const t = setup();
    const first = p.textMessage("one");
    const second = p.textMessage("two");
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: p.WABA_ID,
          changes: [
            p.inboundChange(first),
            p.messagesChange(
              { contacts: [p.contact], messages: [p.textMessage("x")] },
              p.OTHER_PHONE_NUMBER_ID,
            ),
          ],
        },
        { id: p.WABA_ID, changes: [p.inboundChange(second)] },
      ],
    };

    expect(await handleWebhook(body, t.ctx)).toEqual({ processed: 2, ignored: 1, statuses: 0 });
    expect(t.calls("messages.receive").map((input) => input.content)).toEqual(["one", "two"]);
  });

  it("rejects when messages.receive fails, so Meta retries", async () => {
    const t = setup({
      handler: async () => {
        throw new Error("Plugin API call failed: 500");
      },
    });

    await expect(
      handleWebhook(p.envelope(p.inboundChange(p.textMessage())), t.ctx),
    ).rejects.toThrow("500");
  });
});

describe("handleWebhook — media", () => {
  it("uploads an image and uses its caption as content", async () => {
    const { input, t } = await receiveOne(p.imageMessage);

    expect(t.getMedia).toHaveBeenCalledWith("media-img-1", "biz-token");
    expect(t.calls("media.upload")[0]).toMatchObject({
      mimeType: "image/jpeg",
      filename: "image-media-img-1.jpg",
      transcribe: false,
    });
    expect(input.content).toBe("This arrived broken");
    expect(input.attachments).toEqual([upload]);
  });

  it("transcribes a voice note and keeps the audio attachment", async () => {
    const t = setup({ transcript: "where is my parcel" });
    t.getMedia.mockResolvedValue({
      id: "media-aud-1",
      url: "https://lookaside.test/a",
      mime_type: "audio/ogg; codecs=opus",
    });

    await handleWebhook(p.envelope(p.inboundChange(p.voiceNote)), t.ctx);

    expect(t.calls("media.upload")[0]).toMatchObject({
      mimeType: "audio/ogg",
      filename: "audio-media-aud-1.ogg",
      transcribe: true,
    });
    const input = t.calls("messages.receive")[0];
    expect(input.content).toBe("where is my parcel");
    expect(input.attachments).toEqual([upload]);
    expect(input.metadata).toMatchObject({ voiceNote: true, type: "audio" });
  });

  it("sends an attachment-only document with empty content", async () => {
    const { input, t } = await receiveOne(p.documentMessage);

    expect(t.calls("media.upload")[0]).toMatchObject({ filename: "invoice.pdf" });
    expect(input.content).toBe("");
    expect(input.attachments).toEqual([upload]);
  });

  it("falls back to a placeholder when the media cannot be downloaded", async () => {
    const t = setup();
    t.getMedia.mockRejectedValue(new GraphApiError("Media not found", 404));

    const summary = await handleWebhook(p.envelope(p.inboundChange(p.voiceNote)), t.ctx);

    expect(summary.processed).toBe(1);
    const input = t.calls("messages.receive")[0];
    expect(input.content).toBe("[Customer sent an audio that could not be loaded]");
    expect(input).not.toHaveProperty("attachments");
  });

  it("keeps the caption when the media cannot be downloaded", async () => {
    const t = setup();
    t.getMedia.mockRejectedValue(new GraphApiError("Media not found", 404));

    await handleWebhook(p.envelope(p.inboundChange(p.imageMessage)), t.ctx);

    expect(t.calls("messages.receive")[0].content).toBe("This arrived broken");
  });
});

describe("handleWebhook — statuses", () => {
  it.each([
    ["sent", "sent"],
    ["delivered", "delivered"],
    ["read", "read"],
    ["played", "read"],
  ])("maps %s to %s", async (meta, hay) => {
    const t = setup();
    const summary = await handleWebhook(
      p.envelope(p.messagesChange({ statuses: [p.statusEvent(meta)] })),
      t.ctx,
    );

    expect(summary).toEqual({ processed: 0, ignored: 0, statuses: 1 });
    expect(t.calls("messages.updateStatus")).toEqual([
      { providerMessageId: `wamid.OUT-${meta}`, status: hay },
    ]);
  });

  it("reports failures with Meta's error details", async () => {
    const t = setup();
    await handleWebhook(p.envelope(p.messagesChange({ statuses: [p.failedStatus] })), t.ctx);

    expect(t.calls("messages.updateStatus")).toEqual([
      {
        providerMessageId: "wamid.OUT-failed",
        status: "failed",
        error: {
          code: 131047,
          title: "Re-engagement message",
          message: "Message failed to send because more than 24 hours have passed",
        },
      },
    ]);
  });

  it("ignores unknown statuses", async () => {
    const t = setup();
    const summary = await handleWebhook(
      p.envelope(p.messagesChange({ statuses: [p.statusEvent("deleted")] })),
      t.ctx,
    );

    expect(summary).toEqual({ processed: 0, ignored: 1, statuses: 0 });
    expect(t.mutation).not.toHaveBeenCalled();
  });

  it("swallows a failing status update", async () => {
    const t = setup({
      handler: async () => {
        throw new Error("Plugin API call failed: 500");
      },
    });

    const summary = await handleWebhook(
      p.envelope(p.messagesChange({ statuses: [p.statusEvent("read")] })),
      t.ctx,
    );

    expect(summary.statuses).toBe(1);
    expect(t.ctx.logger.warn).toHaveBeenCalled();
  });
});

describe("handleWebhook — account_update", () => {
  it("revokes the connection once when the business removes Hay", async () => {
    const t = setup();
    const body = p.envelope(
      p.accountUpdate("PARTNER_APP_UNINSTALLED"),
      p.accountUpdate("PARTNER_REMOVED"),
    );

    await handleWebhook(body, t.ctx);

    expect(t.calls("connection.revoke")).toEqual([
      { reason: "account_update:PARTNER_APP_UNINSTALLED" },
    ]);
  });

  it("does not revoke in manual mode", async () => {
    const t = setup({ mode: "manual" });

    const summary = await handleWebhook(
      p.envelope(p.accountUpdate("PARTNER_APP_UNINSTALLED")),
      t.ctx,
    );

    expect(t.mutation).not.toHaveBeenCalled();
    expect(summary.ignored).toBe(1);
  });

  it("logs a failing revoke and continues", async () => {
    const t = setup({
      handler: async () => {
        throw new Error("boom");
      },
    });

    await expect(
      handleWebhook(p.envelope(p.accountUpdate("ACCOUNT_OFFBOARDED")), t.ctx),
    ).resolves.toBeDefined();
    expect(t.ctx.logger.error).toHaveBeenCalled();
  });

  it("only logs other account events", async () => {
    const t = setup();

    await handleWebhook(p.envelope(p.accountUpdate("ACCOUNT_VIOLATION")), t.ctx);

    expect(t.mutation).not.toHaveBeenCalled();
    expect(t.ctx.logger.warn).toHaveBeenCalledWith("WhatsApp account update", {
      event: "ACCOUNT_VIOLATION",
    });
  });

  it("ignores other webhook fields", async () => {
    const t = setup();
    const summary = await handleWebhook(
      p.envelope({
        field: "smb_message_echoes",
        value: { metadata: { phone_number_id: p.PHONE_NUMBER_ID } },
      }),
      t.ctx,
    );

    expect(summary).toEqual({ processed: 0, ignored: 1, statuses: 0 });
  });
});
