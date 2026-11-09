/** Long scheduled statements and storage-bound batches get limits of their own, scoped to one transaction. */
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "@server/database/data-source";
import {
  allowStorageWaitInTransaction,
  withLongStatementTimeout,
} from "@server/database/session-limits";

const show = async (setting: string, run = AppDataSource.query.bind(AppDataSource)) => {
  const [row] = await run(`SELECT current_setting($1) AS value`, [setting]);
  return row.value as string;
};

describe("session limits", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  });
  afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("raises the statement limit only inside the job's transaction", async () => {
    const before = await show("statement_timeout");
    const inside = await withLongStatementTimeout((manager) =>
      show("statement_timeout", manager.query.bind(manager)),
    );
    expect(inside).toBe("30min");
    expect(await show("statement_timeout")).toBe(before);
  });

  it("raises the idle limit only inside the batch's transaction", async () => {
    const before = await show("idle_in_transaction_session_timeout");
    const inside = await AppDataSource.transaction(async (manager) => {
      await allowStorageWaitInTransaction(manager);
      return show("idle_in_transaction_session_timeout", manager.query.bind(manager));
    });
    expect(inside).toBe("15min");
    expect(await show("idle_in_transaction_session_timeout")).toBe(before);
  });
});
