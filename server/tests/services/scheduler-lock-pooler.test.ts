import { describe, it, expect, jest } from "@jest/globals";

/**
 * Behind a transaction pooler the scheduler's session-level advisory lock must
 * live on a direct connection: through the pooler the lock and its unlock can
 * land on different backends, and the lock would leak.
 */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/config/env", () => ({ config: { database: { transactionPooler: true } } }));

const pooledQuery = jest.fn<(sql: string) => Promise<unknown>>();
const directQuery = jest.fn<(sql: string) => Promise<unknown>>(async (sql) =>
  sql.includes("pg_try_advisory_lock") ? [{ locked: true }] : [{}],
);
const runner = (query: typeof pooledQuery) => ({
  query,
  connect: jest.fn(async () => undefined),
  release: jest.fn(),
  isReleased: false,
});
const directSource = {
  initialize: jest.fn(async () => undefined),
  destroy: jest.fn(async () => undefined),
  createQueryRunner: () => runner(directQuery),
};
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { isInitialized: true, createQueryRunner: () => runner(pooledQuery) },
  createDirectDataSource: () => directSource,
}));

import { SchedulerService } from "@server/services/scheduler.service";

describe("SchedulerService lock behind a transaction pooler", () => {
  it("takes and releases the job lock on the direct connection", async () => {
    const scheduler = new SchedulerService();
    await scheduler.initialize();
    const handler = jest.fn(async () => undefined);
    scheduler.registerJob({
      name: "pooled-job",
      description: "pooled-job",
      schedule: 60000,
      handler,
      enabled: false,
      skipDatabaseLogging: true,
    });

    await scheduler.runJob("pooled-job");
    await scheduler.shutdown({ gracefulTimeout: 1000 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(directQuery.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining("pg_try_advisory_lock"),
      expect.stringContaining("pg_advisory_unlock"),
    ]);
    expect(pooledQuery).not.toHaveBeenCalled();
    expect(directSource.destroy).toHaveBeenCalled();
  });
});
