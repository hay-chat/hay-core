import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

/**
 * Scheduled jobs run on one server instance at a time: each run takes a
 * Postgres advisory lock (pg_try_advisory_lock) and skips when another
 * instance holds it. `perInstance` jobs never take the lock.
 */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const query = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>();
const runner = {
  query,
  connect: jest.fn(async () => undefined),
  release: jest.fn(),
  isReleased: false,
};
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { isInitialized: true, createQueryRunner: () => runner },
}));

import { SchedulerService } from "@server/services/scheduler.service";

function lockResponse(locked: boolean) {
  return (sql: string) =>
    Promise.resolve(sql.includes("pg_try_advisory_lock") ? [{ locked }] : [{}]);
}

describe("SchedulerService cluster lock", () => {
  let scheduler: SchedulerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    scheduler = new SchedulerService();
    await scheduler.initialize();
  });

  afterEach(async () => {
    await scheduler.shutdown({ gracefulTimeout: 1000 });
  });

  function register(name: string, handler: () => Promise<void>, perInstance = false) {
    scheduler.registerJob({
      name,
      description: name,
      schedule: 60000,
      handler,
      enabled: false,
      skipDatabaseLogging: true,
      perInstance,
    });
  }

  it("runs the job and releases the lock when this instance takes it", async () => {
    query.mockImplementation(lockResponse(true));
    const handler = jest.fn(async () => undefined);
    register("locked-job", handler);

    await scheduler.runJob("locked-job");

    expect(handler).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls.map(([statement]) => statement);
    expect(sql[0]).toContain("pg_try_advisory_lock");
    expect(sql[1]).toContain("pg_advisory_unlock");
    expect(query.mock.calls[0][1]).toEqual(["scheduler:locked-job"]);
  });

  it("skips the run while another instance holds the lock", async () => {
    query.mockImplementation(lockResponse(false));
    const handler = jest.fn(async () => undefined);
    register("busy-job", handler);

    await scheduler.runJob("busy-job");

    expect(handler).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes("pg_advisory_unlock"))).toBe(false);
    expect(scheduler.getJobStatus("busy-job")?.isRunning).toBe(false);
  });

  it("skips the run when the lock cannot be checked", async () => {
    query.mockRejectedValue(new Error("connection lost"));
    const handler = jest.fn(async () => undefined);
    register("unreachable-job", handler);

    await scheduler.runJob("unreachable-job");

    expect(handler).not.toHaveBeenCalled();
  });

  it("never takes the lock for perInstance jobs", async () => {
    const handler = jest.fn(async () => undefined);
    register("local-job", handler, true);

    await scheduler.runJob("local-job");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });
});
