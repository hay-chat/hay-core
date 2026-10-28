import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";

const mockConfig = {
  internal: { apiSecret: "s3cret", operatorEventsUrl: "https://ops.example/events" },
};
jest.mock("@server/config/env", () => {
  const actual = jest.requireActual<typeof import("@server/config/env")>("@server/config/env");
  return { config: { ...actual.config, internal: mockConfig.internal } };
});

import { AppDataSource } from "../../database/data-source";
import { OperatorEventRecord } from "../../database/entities/operator-event.entity";
import {
  MAX_ATTEMPTS,
  notifyOperator,
  RETRY_DELAYS_MS,
  retryOperatorEvents,
} from "../../services/operator-events.service";

/** G3: a failed organization.deleted event is stored, retried with backoff, then given up. */
describe("operator event retry (G3)", () => {
  const orgId = "e1e1e1e1-0000-4000-8000-000000000001";
  const fetchMock = jest.fn<typeof fetch>();
  const repository = () => AppDataSource.getRepository(OperatorEventRecord);
  const event = {
    event: "organization.deleted" as const,
    organizationId: orgId,
    occurredAt: "2026-10-28T00:00:00.000Z",
  };

  /** Make the stored event due now. */
  async function makeDue() {
    await AppDataSource.query(
      `UPDATE operator_events SET next_attempt_at = now() - interval '1 second'
        WHERE organization_id = $1 AND delivered_at IS NULL AND failed_at IS NULL`,
      [orgId],
    );
  }

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
  });
  beforeEach(async () => {
    await repository().delete({ organization_id: orgId });
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });
  afterAll(async () => {
    await repository().delete({ organization_id: orgId });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("retries a failed event until the operator takes it", async () => {
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    expect(await notifyOperator(event)).toBe(false);
    const [stored] = await repository().findBy({ organization_id: orgId });
    expect(stored).toMatchObject({ attempts: 1, last_error: "HTTP 503", delivered_at: null });

    // Not due yet: nothing is sent.
    expect(await retryOperatorEvents()).toEqual({ delivered: 0, rescheduled: 0, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await makeDue();
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const before = Date.now();
    expect(await retryOperatorEvents()).toMatchObject({ rescheduled: 1 });
    const second = await repository().findOneByOrFail({ id: stored.id });
    expect(second.attempts).toBe(2);
    expect(second.last_error).toBe("ECONNRESET");
    expect(second.next_attempt_at!.getTime()).toBeGreaterThanOrEqual(
      before + RETRY_DELAYS_MS[1] - 1000,
    );

    await makeDue();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    expect(await retryOperatorEvents()).toMatchObject({ delivered: 1 });
    const done = await repository().findOneByOrFail({ id: stored.id });
    expect(done.delivered_at).not.toBeNull();
    expect(done.next_attempt_at).toBeNull();
    // Every attempt carries the same event (jsonb may reorder keys) and its own signature.
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual(
      Array(3).fill(event),
    );

    await makeDue();
    expect(await retryOperatorEvents()).toEqual({ delivered: 0, rescheduled: 0, failed: 0 });
  });

  it("gives up after the last attempt", async () => {
    fetchMock.mockResolvedValue(new Response("no", { status: 500 }));
    await notifyOperator(event);
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      await makeDue();
      const summary = await retryOperatorEvents();
      expect(summary).toMatchObject(attempt === MAX_ATTEMPTS ? { failed: 1 } : { rescheduled: 1 });
    }
    const [row] = await repository().findBy({ organization_id: orgId });
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.failed_at).not.toBeNull();
    expect(row.next_attempt_at).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("waits while the operator is not configured", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 500 }));
    await notifyOperator(event);
    await makeDue();
    mockConfig.internal.operatorEventsUrl = "";
    try {
      expect(await retryOperatorEvents()).toEqual({ delivered: 0, rescheduled: 0, failed: 0 });
    } finally {
      mockConfig.internal.operatorEventsUrl = "https://ops.example/events";
    }
    const [row] = await repository().findBy({ organization_id: orgId });
    expect(row.attempts).toBe(1);
  });
});
