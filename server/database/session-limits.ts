import type { EntityManager } from "typeorm";
import { AppDataSource } from "./data-source";

/** Long enough for any scheduled job; the job scheduler enforces its own limit too. */
export const LONG_JOB_STATEMENT_TIMEOUT_MS = 30 * 60 * 1000;

/** How long a batch may wait on storage deletes with its rows locked. */
export const STORAGE_BATCH_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

const setLocal = (manager: EntityManager, setting: string, value: number) =>
  manager.query(`SELECT set_config($1, $2, true)`, [setting, String(value)]);

/** Run a scheduled job's scan or bulk statement past the connection's normal statement limit. */
export function withLongStatementTimeout<T>(
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return AppDataSource.transaction(async (manager) => {
    await setLocal(manager, "statement_timeout", LONG_JOB_STATEMENT_TIMEOUT_MS);
    return work(manager);
  });
}

/** For a transaction that holds locks while it waits on object storage. */
export async function allowStorageWaitInTransaction(manager: EntityManager): Promise<void> {
  await setLocal(manager, "idle_in_transaction_session_timeout", STORAGE_BATCH_IDLE_TIMEOUT_MS);
}
