import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * PluginAPIService.sendEmail: sender-domain policy, passthrough of threading
 * fields and honest failure reporting.
 */

jest.mock("@server/config/env", () => ({
  config: { smtp: { from: { email: "noreply@updates.hay.chat", name: "Hay" } } },
}));
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const sendEmail = jest.fn<(options: Record<string, unknown>) => Promise<Record<string, unknown>>>();
jest.mock("@server/services/email.service", () => ({
  emailService: { initialize: jest.fn(async () => undefined), sendEmail },
}));

import {
  PluginAPIService,
  allowedCustomHeaders,
  isPlatformSenderAddress,
} from "@server/services/plugin-api/plugin-api.service";

describe("allowedCustomHeaders", () => {
  it("keeps threading, auto-responder and X- headers and drops envelope or multi-line ones", () => {
    expect(
      allowedCustomHeaders({
        "In-Reply-To": "<a@b>",
        References: "<a@b> <c@d>",
        "Auto-Submitted": "auto-replied",
        "X-Hay-Conversation": "c1",
        From: "evil@example.com",
        "Return-Path": "<bounce@example.com>",
        "X-Injected": "a\r\nBcc: x@y.z",
      }),
    ).toEqual({
      "In-Reply-To": "<a@b>",
      References: "<a@b> <c@d>",
      "Auto-Submitted": "auto-replied",
      "X-Hay-Conversation": "c1",
    });
    expect(allowedCustomHeaders({ From: "x" })).toBeUndefined();
    expect(allowedCustomHeaders(undefined)).toBeUndefined();
  });
});

const token = {
  pluginId: "hay-channel-email",
  organizationId: "org-1",
  capabilities: ["email"],
};

describe("isPlatformSenderAddress", () => {
  it("accepts any local part on the platform domain, case-insensitively", () => {
    expect(isPlatformSenderAddress("support@updates.hay.chat")).toBe(true);
    expect(isPlatformSenderAddress("Support@Updates.Hay.Chat")).toBe(true);
  });

  it("rejects other domains and malformed values", () => {
    expect(isPlatformSenderAddress("support@acme.com")).toBe(false);
    expect(isPlatformSenderAddress("support@updates.hay.chat.evil.com")).toBe(false);
    expect(isPlatformSenderAddress("not-an-address")).toBe(false);
  });
});

describe("PluginAPIService.sendEmail", () => {
  const service = PluginAPIService.getInstance();

  beforeEach(() => {
    jest.clearAllMocks();
    sendEmail.mockResolvedValue({ success: true, messageId: "<id@relay>" });
  });

  it("refuses a From address outside the platform domain without sending", async () => {
    const result = await service.sendEmail(token, {
      to: "ana@shopper.com",
      subject: "Re: order",
      text: "hi",
      from: { email: "support@acme.com", name: "Acme" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/updates\.hay\.chat/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("passes threading headers, reply-to, message id, retry flag and decoded attachments through", async () => {
    const result = await service.sendEmail(token, {
      to: "ana@shopper.com",
      subject: "Re: order",
      text: "hi",
      from: { email: "support@updates.hay.chat", name: "Acme Support" },
      replyTo: "in-acme+c42@inbound.hay.chat",
      headers: { "In-Reply-To": "<abc@shopper.com>", References: "<abc@shopper.com>" },
      messageId: "<hay-42-1@updates.hay.chat>",
      retry: false,
      attachments: [
        {
          filename: "a.txt",
          contentBase64: Buffer.from("hello").toString("base64"),
          contentType: "text/plain",
        },
      ],
    });

    expect(result).toEqual({ success: true, messageId: "<id@relay>" });
    const options = sendEmail.mock.calls[0][0];
    expect(options).toMatchObject({
      from: { email: "support@updates.hay.chat", name: "Acme Support" },
      replyTo: "in-acme+c42@inbound.hay.chat",
      headers: { "In-Reply-To": "<abc@shopper.com>", References: "<abc@shopper.com>" },
      messageId: "<hay-42-1@updates.hay.chat>",
      retry: false,
    });
    const attachments = options.attachments as Array<{ filename: string; content: Buffer }>;
    expect(attachments[0].filename).toBe("a.txt");
    expect(attachments[0].content.toString()).toBe("hello");
  });

  it("reports a failed send as a failure instead of success", async () => {
    sendEmail.mockResolvedValue({ success: false, error: "550 mailbox unavailable" });

    const result = await service.sendEmail(token, {
      to: "ana@shopper.com",
      subject: "Re: order",
      text: "hi",
    });

    expect(result).toEqual({ success: false, error: "550 mailbox unavailable" });
  });

  it("still requires the email capability", async () => {
    const result = await service.sendEmail(
      { ...token, capabilities: ["messages"] },
      { to: "a@b.c", subject: "s", text: "t" },
    );
    expect(result.success).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
