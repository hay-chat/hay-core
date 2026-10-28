import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import crypto from "crypto";

const mockConfig = {
  internal: { apiSecret: "s3cret", operatorEventsUrl: "https://ops.example/events" },
};
jest.mock("@server/config/env", () => ({ config: mockConfig }));
const inserted: Array<Record<string, unknown>> = [];
jest.mock("@server/database/data-source", () => ({
  AppDataSource: {
    getRepository: () => ({
      insert: jest.fn(async (row: Record<string, unknown>) => {
        inserted.push(row);
      }),
    }),
  },
}));
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import {
  notifyOperator,
  RETRY_DELAYS_MS,
  signOperatorEvent,
} from "@server/services/operator-events.service";

const event = {
  event: "organization.deleted" as const,
  organizationId: "org-1",
  occurredAt: "2026-10-28T00:00:00.000Z",
};

describe("operator events (D15-11)", () => {
  const fetchMock = jest.fn<typeof fetch>();

  beforeEach(() => {
    mockConfig.internal.apiSecret = "s3cret";
    mockConfig.internal.operatorEventsUrl = "https://ops.example/events";
    fetchMock.mockReset();
    inserted.length = 0;
    global.fetch = fetchMock;
  });
  afterEach(() => jest.restoreAllMocks());

  it("signs t.<body> with HMAC-SHA256", () => {
    const body = JSON.stringify(event);
    const header = signOperatorEvent(body, "s3cret", 1_700_000_000_000);
    const expected = crypto
      .createHmac("sha256", "s3cret")
      .update(`1700000000.${body}`)
      .digest("hex");
    expect(header).toBe(`t=1700000000,v1=${expected}`);
  });

  it("posts the signed event", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await notifyOperator(event)).toBe(true);
    expect(inserted).toHaveLength(0);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ops.example/events");
    expect(init?.body).toBe(JSON.stringify(event));
    expect((init?.headers as Record<string, string>)["x-hay-signature"]).toMatch(
      /^t=\d+,v1=[0-9a-f]{64}$/,
    );
  });

  it("does nothing when not configured (self-hosting default)", async () => {
    mockConfig.internal.operatorEventsUrl = "";
    expect(await notifyOperator(event)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("never throws when the operator is down, and stores the event for retry (G3)", async () => {
    const before = Date.now();
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await notifyOperator(event)).toBe(false);
    fetchMock.mockResolvedValue(new Response("no", { status: 500 }));
    expect(await notifyOperator(event)).toBe(false);
    expect(inserted.map((row) => row.last_error)).toEqual(["ECONNREFUSED", "HTTP 500"]);
    expect(inserted[0]).toMatchObject({
      event: "organization.deleted",
      organization_id: "org-1",
      payload: event,
      attempts: 1,
    });
    const due = (inserted[0].next_attempt_at as Date).getTime();
    expect(due).toBeGreaterThanOrEqual(before + RETRY_DELAYS_MS[0]);
  });
});
