import { describe, expect, it } from "vitest";
import { handleInbound, looksLikeMerchantReply } from "./inbound.js";
import {
  CONVERSATION_ID,
  fakeApi,
  fakeContext,
  fakeResend,
  receivedEmail,
  settings,
} from "./test/fakes.js";

const event = (emailId = "email-1") => ({
  type: "email.received",
  created_at: "2026-10-26T10:00:00Z",
  data: { email_id: emailId, from: "ana@shopper.com", to: ["support@acme.com"] },
});

function setup(
  email = receivedEmail(),
  options: Parameters<typeof fakeApi>[0] = {},
  files: Record<string, { body: string; type?: string }> = {},
  attachmentLists: Record<string, unknown[]> = {},
) {
  const resend = fakeResend({ [email.id]: email }, files, attachmentLists);
  const api = fakeApi(options);
  const ctx = fakeContext({ api, getResend: () => resend.client });
  return { ctx, api, resend };
}

describe("handleInbound", () => {
  it("creates a conversation for a first email: root id, subject, stripped body, sender identity", async () => {
    const { ctx, api } = setup(
      receivedEmail({
        text: "Hi, order 1234 has not arrived.\n\nOn Mon, Acme <x@y.z> wrote:\n> old stuff",
      }),
    );

    const summary = await handleInbound(event(), ctx);

    expect(summary).toEqual({ outcome: "processed", conversationId: CONVERSATION_ID });
    const receive = api.mutations.find((call) => call.procedure === "messages.receive");
    expect(receive?.input).toMatchObject({
      from: "ana@shopper.com",
      channel: "email",
      content: "Hi, order 1234 has not arrived.",
      externalConversationId: "<abc@shopper.com>",
      title: "Where is my order?",
      metadata: {
        mid: "<abc@shopper.com>",
        email: "ana@shopper.com",
        profileName: "Ana Shopper",
        subject: "Where is my order?",
      },
    });
    expect(receive?.input.conversationId).toBeUndefined();
    expect(receive?.input.holdForHuman).toBeUndefined();
    expect(ctx.state.inboundCount).toBe(1);
  });

  it("pins a reply to its conversation by the Reply-To token and threads by the root reference", async () => {
    const token = `in-abc123def4+c${CONVERSATION_ID}@inbound.hay.test`;
    const { ctx, api } = setup(
      receivedEmail({
        id: "email-2",
        to: [token],
        subject: "Re: Where is my order?",
        text: "Thanks!",
        message_id: "<def@shopper.com>",
        headers: {
          "in-reply-to": "<hay-msg-9@updates.hay.test>",
          references: "<abc@shopper.com> <hay-msg-9@updates.hay.test>",
        },
      }),
      { messages: [{ type: "Customer", providerMessageId: "<abc@shopper.com>" }] },
    );

    await handleInbound(event("email-2"), ctx);

    const receive = api.mutations.find((call) => call.procedure === "messages.receive");
    expect(receive?.input).toMatchObject({
      conversationId: CONVERSATION_ID,
      externalConversationId: "<abc@shopper.com>",
      content: "Thanks!",
      metadata: { inReplyTo: "<hay-msg-9@updates.hay.test>" },
    });
    expect(receive?.input.holdForHuman).toBeUndefined();
  });

  it("falls back to the raw message for threading headers when the API omits them", async () => {
    const { ctx, api } = setup(
      receivedEmail({
        id: "email-3",
        headers: { "message-id": "<def@shopper.com>" },
        message_id: "<def@shopper.com>",
        raw: { download_url: "https://files.resend.test/raw-3" },
      }),
      {},
      {
        "https://files.resend.test/raw-3": {
          body: "From: ana@shopper.com\r\nReferences: <abc@shopper.com>\r\n <hay-1@updates.hay.test>\r\nIn-Reply-To: <hay-1@updates.hay.test>\r\n\r\nbody",
        },
      },
    );

    await handleInbound(event("email-3"), ctx);

    const receive = api.mutations.find((call) => call.procedure === "messages.receive");
    expect(receive?.input.externalConversationId).toBe("<abc@shopper.com>");
  });

  it("holds a reply that answers a message a human sent from the store's own mailbox", async () => {
    const token = `in-abc123def4+c${CONVERSATION_ID}@inbound.hay.test`;
    const { ctx, api } = setup(
      receivedEmail({
        id: "email-4",
        to: [token],
        text: "Great, thanks Maria!",
        message_id: "<ghi@shopper.com>",
        headers: {
          "in-reply-to": "<CAF123@mail.gmail.com>",
          references: "<abc@shopper.com> <CAF123@mail.gmail.com>",
        },
      }),
      { messages: [{ type: "Customer", providerMessageId: "<abc@shopper.com>" }] },
    );

    const summary = await handleInbound(event("email-4"), ctx);

    expect(summary).toMatchObject({ outcome: "held", reason: "out-of-band-reply" });
    const receive = api.mutations.find((call) => call.procedure === "messages.receive");
    expect(receive?.input.holdForHuman).toBe(true);
  });

  it("holds DMARC failures and ignores echoes, bounces and auto-replies", async () => {
    const dmarc = setup(
      receivedEmail({
        id: "e-dmarc",
        authentication: { spf: "fail", dkim: "fail", dmarc: "fail" },
      }),
    );
    expect(await handleInbound(event("e-dmarc"), dmarc.ctx)).toMatchObject({
      outcome: "held",
      reason: "dmarc-fail",
    });

    const echo = setup(
      receivedEmail({ id: "e-echo", headers: { "x-hay-conversation": CONVERSATION_ID } }),
    );
    expect(await handleInbound(event("e-echo"), echo.ctx)).toMatchObject({
      outcome: "ignored",
      kind: "echo",
    });
    expect(echo.api.mutations).toHaveLength(0);

    const bounce = setup(receivedEmail({ id: "e-bounce", from: "mailer-daemon@mx.google.com" }));
    expect(await handleInbound(event("e-bounce"), bounce.ctx)).toMatchObject({
      outcome: "ignored",
      kind: "bounce",
    });

    const auto = setup(
      receivedEmail({ id: "e-auto", headers: { "auto-submitted": "auto-replied" } }),
    );
    expect(await handleInbound(event("e-auto"), auto.ctx)).toMatchObject({
      outcome: "ignored",
      kind: "auto-reply",
    });
  });

  it("captures Gmail's forwarding confirmation into state instead of a conversation", async () => {
    const { ctx, api } = setup(
      receivedEmail({
        id: "e-fwd",
        from: "forwarding-noreply@google.com",
        subject: "(#574839201) Gmail Forwarding Confirmation",
        text: "Confirmation code: 574839201\nhttps://mail-settings.google.com/mail/vf-abc",
      }),
    );

    expect(await handleInbound(event("e-fwd"), ctx)).toMatchObject({
      kind: "forwarding-confirmation",
    });
    expect(api.mutations).toHaveLength(0);
    expect(ctx.state.forwarding).toMatchObject({
      code: "574839201",
      link: "https://mail-settings.google.com/mail/vf-abc",
      recipient: "in-abc123def4@inbound.hay.test",
    });
  });

  it("uploads real attachments, skips small inline images and passes them to messages.receive", async () => {
    const { ctx, api } = setup(
      receivedEmail({
        id: "e-att",
        text: "See attached",
        attachments: [
          { id: "a1", filename: "receipt.pdf", content_type: "application/pdf", size: 4 },
          {
            id: "a2",
            filename: "logo.png",
            content_type: "image/png",
            content_disposition: "inline",
            size: 2048,
          },
        ],
      }),
      {},
      { "https://files.resend.test/a1": { body: "%PDF", type: "application/pdf" } },
      {
        "e-att": [
          {
            id: "a1",
            filename: "receipt.pdf",
            content_type: "application/pdf",
            size: 4,
            download_url: "https://files.resend.test/a1",
          },
          {
            id: "a2",
            filename: "logo.png",
            content_type: "image/png",
            content_disposition: "inline",
            size: 2048,
            download_url: "https://files.resend.test/a2",
          },
        ],
      },
    );

    await handleInbound(event("e-att"), ctx);

    const upload = api.mutations.filter((call) => call.procedure === "media.upload");
    expect(upload).toHaveLength(1);
    expect(upload[0].input).toMatchObject({ filename: "receipt.pdf", mimeType: "application/pdf" });
    const receive = api.mutations.find((call) => call.procedure === "messages.receive");
    expect(receive?.input.attachments).toEqual([
      expect.objectContaining({ name: "receipt.pdf", url: "https://cdn.hay.test/receipt.pdf" }),
    ]);
  });

  it("ingests a pasted screenshot but not a tracking pixel of unknown size (D8-7)", async () => {
    const screenshot = "x".repeat(30 * 1024);
    const { ctx, api } = setup(
      receivedEmail({
        id: "e-inline",
        text: "This is what I see",
        attachments: [{ id: "s", filename: "image001.png", content_type: "image/png" }],
      }),
      {},
      {
        "https://files.resend.test/shot": { body: screenshot, type: "image/png" },
        "https://files.resend.test/pixel": { body: "GIF89a", type: "image/gif" },
      },
      {
        "e-inline": [
          {
            id: "s",
            filename: "image001.png",
            content_type: "image/png",
            content_disposition: "inline",
            size: screenshot.length,
            download_url: "https://files.resend.test/shot",
          },
          {
            id: "p",
            filename: "pixel.gif",
            content_type: "image/gif",
            content_disposition: "inline",
            download_url: "https://files.resend.test/pixel",
          },
          {
            id: "c",
            filename: "part.css",
            content_type: "text/css",
            content_disposition: "inline",
            size: 40 * 1024,
            download_url: "https://files.resend.test/css",
          },
        ],
      },
    );
    await handleInbound(event("e-inline"), ctx);

    const uploads = api.mutations.filter((call) => call.procedure === "media.upload");
    expect(uploads.map((call) => call.input.filename)).toEqual(["image001.png"]);
    const receive = api.mutations.find((call) => call.procedure === "messages.receive");
    expect(receive?.input.content).toBe("This is what I see");
    expect((receive?.input.metadata as Record<string, unknown>).rejectedAttachments).toBeUndefined();
  });

  it("reports refused attachments in metadata and never sends an empty turn (D8-7)", async () => {
    const { ctx, api } = setup(
      receivedEmail({
        id: "e-heic",
        text: "",
        html: "",
        attachments: [{ id: "h", filename: "IMG_0001.HEIC", content_type: "image/heic" }],
      }),
      { uploadRejects: ["IMG_0001.HEIC"] },
      {
        "https://files.resend.test/heic": { body: "heic", type: "image/heic" },
        "https://files.resend.test/pdf": { body: "%PDF", type: "application/pdf" },
      },
      {
        "e-heic": [
          {
            id: "h",
            filename: "IMG_0001.HEIC",
            content_type: "image/heic",
            download_url: "https://files.resend.test/heic",
          },
          {
            id: "d",
            filename: "invoice.pdf",
            content_type: "application/pdf",
            download_url: "https://files.resend.test/pdf",
          },
        ],
      },
    );
    const summary = await handleInbound(event("e-heic"), ctx);

    expect(summary.outcome).toBe("processed");
    const receive = api.mutations.find((call) => call.procedure === "messages.receive");
    expect(receive?.input.content).toBe(
      "[Customer sent a file]\n[Customer sent attachments Hay.chat could not accept: IMG_0001.HEIC]",
    );
    expect(receive?.input.metadata).toMatchObject({
      rejectedAttachments: [
        { filename: "IMG_0001.HEIC", type: "image/heic", reason: "not_accepted" },
      ],
    });
    expect((receive?.input.metadata as Record<string, unknown>).mediaPlaceholder).toBeUndefined();
  });

  it("reports dedupes and ignores non-email events or unconfigured channels", async () => {
    const deduped = setup(receivedEmail(), { receive: { deduped: true, processed: false } });
    expect(await handleInbound(event(), deduped.ctx)).toMatchObject({ outcome: "deduped" });

    const { ctx } = setup();
    expect(await handleInbound({ type: "email.sent", data: {} }, ctx)).toMatchObject({
      outcome: "ignored",
    });

    const unconfigured = fakeContext({ settings: null });
    expect(await handleInbound(event(), unconfigured)).toMatchObject({
      outcome: "ignored",
      reason: "not_configured",
    });
  });
});

describe("looksLikeMerchantReply", () => {
  const known = new Set(["<abc@shopper.com>"]);

  it("flags unknown ids from the merchant's domain or Google/Microsoft mail systems", () => {
    expect(looksLikeMerchantReply("<x@acme.com>", known, "acme.com")).toBe(true);
    expect(looksLikeMerchantReply("<x@mail.gmail.com>", known, "acme.com")).toBe(true);
    expect(looksLikeMerchantReply("<x@EUR01.prod.outlook.com>", known, "acme.com")).toBe(true);
  });

  it("never flags known ids, Hay ids or relay ids", () => {
    expect(looksLikeMerchantReply("<abc@shopper.com>", known, "acme.com")).toBe(false);
    expect(looksLikeMerchantReply("<hay-1@updates.hay.test>", known, "acme.com")).toBe(false);
    expect(looksLikeMerchantReply("<rewritten@resend.dev>", known, "acme.com")).toBe(false);
    // Without a configured support address any unknown Gmail id is still suspicious.
    expect(looksLikeMerchantReply("<x@mail.gmail.com>", known, null)).toBe(true);
  });
});
