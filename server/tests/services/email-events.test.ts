import crypto from "crypto";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * D13-10: Resend bounces/complaints/deliveries land on the outbound message's
 * providerStatus/providerError; the webhook rejects unsigned requests.
 */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const findOutbound = jest.fn<(ids: string[]) => Promise<unknown>>();
const update = jest.fn<(id: string, data: Record<string, unknown>) => Promise<unknown>>();
jest.mock("@server/repositories/message.repository", () => ({
  messageRepository: { findOutboundByProviderMessageIds: findOutbound, update },
}));
const publish = jest.fn<(channel: string, event: unknown) => Promise<void>>();
jest.mock("@server/services/redis.service", () => ({ redisService: { publish } }));

const recordDeliveryFailure = jest.fn<(organizationId: string, channel: string) => Promise<void>>();
jest.mock("@server/services/channel-health.service", () => ({
  channelHealthService: { recordDeliveryFailure },
}));

import { applyEmailEvent, messageIdCandidates } from "@server/services/email-events.service";
import emailEventsRouter from "@server/routes/email-events";

const message = (overrides: Record<string, unknown> = {}) => ({
  message: {
    id: "m1",
    conversation_id: "c1",
    providerStatus: "sent",
    providerError: null,
    ...overrides,
  },
  organizationId: "org-1",
  channel: "email",
});

const bounce = {
  type: "email.bounced",
  data: {
    email_id: "e1",
    message_id: "<hay-m1@updates.hay.chat>",
    bounce: { type: "Permanent", subType: "General", message: "Mailbox does not exist" },
  },
};

describe("applyEmailEvent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("matches the Message-ID with and without brackets", () => {
    expect(messageIdCandidates({ data: { message_id: "abc@x" } })).toEqual(["abc@x", "<abc@x>"]);
  });

  it("marks a bounced message failed with the bounce reason and tells the dashboard", async () => {
    findOutbound.mockResolvedValue(message());
    const outcome = await applyEmailEvent(bounce);

    expect(findOutbound).toHaveBeenCalledWith([
      "hay-m1@updates.hay.chat",
      "<hay-m1@updates.hay.chat>",
    ]);
    expect(update).toHaveBeenCalledWith("m1", {
      providerStatus: "failed",
      providerError: {
        code: "bounced",
        title: "Permanent / General",
        message: "Mailbox does not exist",
      },
    });
    expect(publish).toHaveBeenCalledWith(
      "websocket:events",
      expect.objectContaining({ type: "message_status_updated", organizationId: "org-1" }),
    );
    expect(outcome).toMatchObject({ handled: true, providerStatus: "failed", channel: "email" });
  });

  it("records a complaint without changing the status", async () => {
    findOutbound.mockResolvedValue(message({ providerStatus: "delivered" }));
    await applyEmailEvent({ type: "email.complained", data: { message_id: "<hay-m1@x>" } });
    expect(update).toHaveBeenCalledWith("m1", {
      providerStatus: "delivered",
      providerError: { code: "complained", title: "Marked as spam" },
    });
  });

  it("never moves a failed message back to delivered", async () => {
    findOutbound.mockResolvedValue(message({ providerStatus: "failed" }));
    const outcome = await applyEmailEvent({
      type: "email.delivered",
      data: { message_id: "<a@b>" },
    });
    expect(outcome).toEqual({ handled: false, reason: "status_not_newer" });
    expect(update).not.toHaveBeenCalled();
  });

  it("ignores other event types and unknown messages", async () => {
    expect(await applyEmailEvent({ type: "email.opened", data: { message_id: "<a@b>" } })).toEqual({
      handled: false,
      reason: "ignored_type",
    });
    findOutbound.mockResolvedValue(null);
    expect(await applyEmailEvent(bounce)).toEqual({ handled: false, reason: "message_not_found" });
  });
});

describe("POST /v1/webhooks/email-events", () => {
  const secretBytes = crypto.randomBytes(24);
  const secret = `whsec_${secretBytes.toString("base64")}`;

  type Handler = (req: unknown, res: unknown) => Promise<void>;
  const layer = (
    emailEventsRouter as unknown as {
      stack: Array<{ route: { path: string; stack: Array<{ handle: Handler }> } }>;
    }
  ).stack.find((entry) => entry.route?.path === "/v1/webhooks/email-events");
  const handler = layer!.route.stack[0].handle;

  function call(headers: Record<string, string>, body: unknown) {
    const raw = JSON.stringify(body);
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return handler({ headers, body, rawBody: raw }, res).then(() => ({ res, raw }));
  }

  function signed(body: unknown) {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = crypto
      .createHmac("sha256", secretBytes)
      .update(`msg_1.${ts}.`)
      .update(raw)
      .digest("base64");
    return { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": `v1,${signature}` };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_EVENTS_WEBHOOK_SECRET = secret;
  });

  it("rejects an unsigned or badly signed request without touching messages", async () => {
    const { res } = await call(
      { "svix-id": "x", "svix-timestamp": "1", "svix-signature": "v1,AAAA" },
      bounce,
    );
    expect(res.statusCode).toBe(401);
    expect(findOutbound).not.toHaveBeenCalled();
  });

  it("applies a correctly signed bounce", async () => {
    findOutbound.mockResolvedValue(message());
    const { res } = await call(signed(bounce), bounce);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, handled: true });
    expect(update).toHaveBeenCalled();
    // One recipient's bounce says nothing about the channel.
    expect(recordDeliveryFailure).not.toHaveBeenCalled();
  });

  it("answers 503 when the secret is not configured", async () => {
    delete process.env.RESEND_EVENTS_WEBHOOK_SECRET;
    const { res } = await call(signed(bounce), bounce);
    expect(res.statusCode).toBe(503);
  });
});
