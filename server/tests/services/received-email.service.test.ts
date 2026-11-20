import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

const mockFindByKey =
  jest.fn<
    (
      pluginId: string,
      key: string,
    ) => Promise<{ organizationId: string; pluginInstanceId: string } | null>
  >();
jest.mock("@server/repositories/plugin-webhook-route.repository", () => ({
  pluginWebhookRouteRepository: { findByKey: mockFindByKey },
}));

import { ReceivedEmailError, receivedEmailService } from "@server/services/received-email.service";

const PLUGIN = "email-plugin";
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY_B = "in-bbbbbbbbbb@inbound.test";

const emailForB = {
  id: "email-1",
  from: "shopper@example.com",
  to: ["Support <in-bbbbbbbbbb+c123@Inbound.test>"],
  subject: "Hello",
  text: "body",
  unrelated_field: "dropped",
};

let fetchMock: jest.Mock<typeof fetch>;

function respond(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.RESEND_API_KEY = "re_platform";
  mockFindByKey.mockImplementation(async (pluginId, key) =>
    pluginId === PLUGIN && key === KEY_B
      ? { organizationId: ORG_B, pluginInstanceId: "instance-b" }
      : null,
  );
  fetchMock = jest.fn<typeof fetch>();
  global.fetch = fetchMock;
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
});

async function kindOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof ReceivedEmailError ? error.kind : "other";
  }
  return undefined;
}

describe("receivedEmailService org scope", () => {
  it("returns the email to the organization it was addressed to, trimmed to known fields", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, emailForB));

    const email = await receivedEmailService.get("email-1", PLUGIN, ORG_B);

    expect(email).toMatchObject({ id: "email-1", subject: "Hello", text: "body" });
    expect(email).not.toHaveProperty("unrelated_field");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails/receiving/email-1");
  });

  it.each([
    ["to", { to: [KEY_B], received_for: ["support@store.test"] }],
    ["received_for", { to: ["support@store.test"], received_for: [KEY_B] }],
  ])("accepts forwarded mail with the routing key in %s", async (_field, recipients) => {
    fetchMock.mockResolvedValueOnce(respond(200, { ...emailForB, ...recipients }));

    await expect(receivedEmailService.get("email-1", PLUGIN, ORG_B)).resolves.toMatchObject({
      id: "email-1",
    });
  });

  it("refuses mail with the routing key in neither recipient list", async () => {
    const elsewhere = { ...emailForB, to: ["support@store.test"], received_for: ["a@store.test"] };
    fetchMock.mockResolvedValueOnce(respond(200, elsewhere));

    expect(await kindOf(receivedEmailService.get("email-1", PLUGIN, ORG_B))).toBe("not_found");
  });

  it("answers an email addressed to another organization like an unknown id", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, emailForB));
    const otherOrg = await kindOf(receivedEmailService.get("email-1", PLUGIN, ORG_A));

    fetchMock.mockResolvedValueOnce(respond(404, { message: "not found" }));
    const unknown = await kindOf(receivedEmailService.get("missing", PLUGIN, ORG_A));

    expect(otherOrg).toBe("not_found");
    expect(unknown).toBe("not_found");
  });

  it("does not list attachments of another organization's email", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, emailForB));

    expect(await kindOf(receivedEmailService.listAttachments("email-1", PLUGIN, ORG_A))).toBe(
      "not_found",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not match a routing key held under another plugin", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, emailForB));

    expect(await kindOf(receivedEmailService.get("email-1", "other-plugin", ORG_B))).toBe(
      "not_found",
    );
  });

  it("lists attachment metadata for the owning organization", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, emailForB)).mockResolvedValueOnce(
      respond(200, {
        data: [{ id: "a1", filename: "a.pdf", content_type: "application/pdf", extra: 1 }],
      }),
    );

    const list = await receivedEmailService.listAttachments("email-1", PLUGIN, ORG_B);

    expect(list).toEqual([expect.objectContaining({ id: "a1", filename: "a.pdf" })]);
    expect(list[0]).not.toHaveProperty("extra");
  });
});

describe("receivedEmailService provider failures", () => {
  it.each([
    [429, "unavailable"],
    [503, "unavailable"],
    [401, "provider_error"],
  ])("maps a Resend %s to %s", async (status, kind) => {
    fetchMock.mockResolvedValueOnce(respond(status));
    expect(await kindOf(receivedEmailService.get("email-1", PLUGIN, ORG_B))).toBe(kind);
  });

  it("reports a network failure or timeout as unavailable", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await kindOf(receivedEmailService.get("email-1", PLUGIN, ORG_B))).toBe("unavailable");
  });

  it("is not available without the platform key", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await kindOf(receivedEmailService.get("email-1", PLUGIN, ORG_B))).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
