import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  NOTIFY_TOOL_RISK,
  SEND_EMAIL_TOOL,
  createNotifyServer,
  resolveNotificationRecipients,
  sendTeamEmail,
  type NotifyDeps,
} from "./notify.js";
import { fakeApi, fakeLogger, settings } from "./test/fakes.js";

function deps(overrides: Partial<NotifyDeps> = {}): NotifyDeps {
  return {
    getSettings: () => settings,
    getRecipients: () => ["ops@acme.com", "owner@acme.com"],
    api: fakeApi(),
    logger: fakeLogger(),
    ...overrides,
  };
}

describe("resolveNotificationRecipients", () => {
  it("parses a comma-separated list, lowercases and dedupes", () => {
    expect(
      resolveNotificationRecipients(" Ops@Acme.com, owner@acme.com ,ops@acme.com ", null),
    ).toEqual({ recipients: ["ops@acme.com", "owner@acme.com"], invalid: [] });
  });

  it("accepts display-name forms", () => {
    expect(resolveNotificationRecipients("Ops Team <ops@acme.com>", null).recipients).toEqual([
      "ops@acme.com",
    ]);
  });

  it("reports invalid entries and keeps the valid ones", () => {
    expect(resolveNotificationRecipients("ops@acme.com, not-an-email, a@b", null)).toEqual({
      recipients: ["ops@acme.com"],
      invalid: ["not-an-email", "a@b"],
    });
  });

  it("falls back to the support address when nothing valid is configured", () => {
    expect(resolveNotificationRecipients(undefined, "support@acme.com").recipients).toEqual([
      "support@acme.com",
    ]);
    expect(resolveNotificationRecipients("junk", "support@acme.com")).toEqual({
      recipients: ["support@acme.com"],
      invalid: ["junk"],
    });
  });

  it("is empty with neither", () => {
    expect(resolveNotificationRecipients("", null).recipients).toEqual([]);
  });
});

describe("sendTeamEmail", () => {
  it("sends to the configured team from the channel sender", async () => {
    const api = fakeApi({ sendResult: { success: true, messageId: "mid-1" } });
    const result = await sendTeamEmail(
      { subject: "Refund request", body: "Order 1234" },
      deps({ api }),
    );
    expect(api.sent).toEqual([
      {
        to: ["ops@acme.com", "owner@acme.com"],
        subject: "Refund request",
        body: "Order 1234",
        from: { email: "support@updates.hay.test", name: "Acme Support" },
        headers: { "Auto-Submitted": "auto-generated" },
      },
    ]);
    expect(result).toEqual({
      success: true,
      message: "Email sent to 2 recipient(s)",
      messageId: "mid-1",
      recipients: ["ops@acme.com", "owner@acme.com"],
      subject: "Refund request",
    });
  });

  it("uses the platform default sender when the inbound env is missing", async () => {
    const api = fakeApi();
    await sendTeamEmail({ subject: "s", body: "b" }, deps({ api, getSettings: () => null }));
    expect(api.sent[0].from).toBeUndefined();
  });

  it("never takes a recipient from the tool arguments", async () => {
    const api = fakeApi();
    await sendTeamEmail(
      { subject: "s", body: "b", to: ["attacker@evil.com"] },
      deps({ api, getRecipients: () => ["ops@acme.com"] }),
    );
    expect(api.sent[0].to).toEqual(["ops@acme.com"]);
  });

  it("requires subject and body", async () => {
    await expect(sendTeamEmail({ subject: "s" }, deps())).rejects.toThrow(
      "Subject and body are required",
    );
    await expect(sendTeamEmail({ subject: " ", body: "b" }, deps())).rejects.toThrow(
      "Subject and body are required",
    );
  });

  it("fails clearly with no recipients", async () => {
    const api = fakeApi();
    await expect(
      sendTeamEmail({ subject: "s", body: "b" }, deps({ api, getRecipients: () => [] })),
    ).rejects.toThrow(/No team address configured/);
    expect(api.sent).toEqual([]);
  });

  it("reports a refused send as a failure, not success", async () => {
    const api = fakeApi({ sendResult: { success: false, error: "relay refused" } });
    await expect(sendTeamEmail({ subject: "s", body: "b" }, deps({ api }))).rejects.toThrow(
      "Failed to send email: relay refused",
    );
  });
});

describe("createNotifyServer", () => {
  it("lists only send-email", async () => {
    const server = createNotifyServer(deps());
    expect(await server.listTools()).toEqual([SEND_EMAIL_TOOL]);
  });

  it("declares a risk class for every listed tool, so core does not hold send-email", async () => {
    const { withToolRisk, CATEGORY_META_KEY } = createRequire(import.meta.url)(
      "@hay/plugin-sdk/tool-risk",
    );
    const listed = withToolRisk(await createNotifyServer(deps()).listTools(), NOTIFY_TOOL_RISK);
    for (const tool of listed) {
      expect(tool.annotations.readOnlyHint).toBe(false);
      expect(tool._meta[CATEGORY_META_KEY]).toBe("other_write");
    }
  });

  it("reads recipients at call time so config edits apply without a restart", async () => {
    const api = fakeApi();
    let recipients = ["first@acme.com"];
    const server = createNotifyServer(deps({ api, getRecipients: () => recipients }));
    await server.callTool("send-email", { subject: "s", body: "b" });
    recipients = ["second@acme.com"];
    await server.callTool("send-email", { subject: "s", body: "b" });
    expect(api.sent.map((sent) => sent.to)).toEqual([["first@acme.com"], ["second@acme.com"]]);
  });

  it("rejects unknown tools", async () => {
    await expect(createNotifyServer(deps()).callTool("healthcheck", {})).rejects.toThrow(
      "Unknown tool: healthcheck",
    );
  });
});
