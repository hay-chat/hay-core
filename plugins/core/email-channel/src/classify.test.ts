import { describe, expect, it } from "vitest";
import { classifyInbound, extractForwardingConfirmation } from "./classify.js";
import { headersFromObject } from "./mime.js";

const base = { from: "Ana <ana@shopper.com>", subject: "Order 1234" };

describe("classifyInbound", () => {
  it("treats a plain shopper email as customer", () => {
    expect(classifyInbound({ ...base, headers: {} })).toEqual({ kind: "customer", hold: false });
  });

  it("recognises our own forwarded copy as an echo", () => {
    expect(
      classifyInbound({ ...base, headers: headersFromObject({ "X-Hay-Conversation": "c1" }) }).kind,
    ).toBe("echo");
  });

  it("recognises our own mail by From address or Message-ID when the custom header is missing", () => {
    expect(
      classifyInbound({
        ...base,
        from: "Acme Support <Support@updates.hay.test>",
        headers: {},
        ownAddress: "support@updates.hay.test",
      }),
    ).toEqual({ kind: "echo", hold: false, reason: "own-address" });
    expect(
      classifyInbound({ ...base, headers: {}, messageId: "<hay-msg-1@updates.hay.test>" }),
    ).toEqual({ kind: "echo", hold: false, reason: "own-message-id" });
    expect(
      classifyInbound({ ...base, headers: {}, ownAddress: "support@updates.hay.test" }).kind,
    ).toBe("customer");
  });

  it("recognises Gmail's forwarding confirmation", () => {
    expect(
      classifyInbound({
        from: "forwarding-noreply@google.com",
        subject: "(#123456789) Gmail Forwarding Confirmation",
        headers: {},
      }).kind,
    ).toBe("forwarding-confirmation");
  });

  it("recognises bounces, auto-replies and list mail", () => {
    expect(
      classifyInbound({ ...base, from: "MAILER-DAEMON@mx.google.com", headers: {} }).kind,
    ).toBe("bounce");
    expect(
      classifyInbound({
        ...base,
        headers: headersFromObject({
          "Content-Type": "multipart/report; report-type=delivery-status",
        }),
      }).kind,
    ).toBe("bounce");
    expect(
      classifyInbound({ ...base, headers: headersFromObject({ "Auto-Submitted": "auto-replied" }) })
        .kind,
    ).toBe("auto-reply");
    expect(
      classifyInbound({ ...base, subject: "Automatic reply: Order 1234", headers: {} }).kind,
    ).toBe("auto-reply");
    expect(
      classifyInbound({ ...base, headers: headersFromObject({ "List-Id": "<news.list>" }) }).kind,
    ).toBe("bulk");
    expect(
      classifyInbound({ ...base, headers: headersFromObject({ Precedence: "bulk" }) }).kind,
    ).toBe("bulk");
  });

  it("keeps a DMARC failure as a customer message held for a human", () => {
    expect(
      classifyInbound({
        ...base,
        headers: {},
        authentication: { spf: "fail", dkim: "fail", dmarc: "fail" },
      }),
    ).toEqual({ kind: "customer", hold: true, reason: "dmarc-fail" });
    expect(
      classifyInbound({
        ...base,
        headers: {},
        authentication: { spf: "fail", dkim: "pass", dmarc: "pass" },
      }).hold,
    ).toBe(false);
  });
});

describe("extractForwardingConfirmation", () => {
  it("finds the code and the link in Google's message", () => {
    const text =
      "support@acme.com has requested to automatically forward mail to your email address.\n" +
      "Confirmation code: 574839201\n" +
      "https://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc.\n";
    expect(extractForwardingConfirmation(text)).toEqual({
      code: "574839201",
      link: "https://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc",
    });
  });
});
