import { AsyncLocalStorage } from "async_hooks";
import type { EntityManager } from "typeorm";
import { AppDataSource } from "./data-source";

/** The setting row-level security policies read. */
export const ORGANIZATION_SETTING = "app.organization_id";

type ContextScope =
  { kind: "organization"; organizationId: string } | { kind: "system"; reason: string };

/** A scope plus the transaction currently open for it, if any. */
type ContextState = ContextScope & { manager?: EntityManager };

const storage = new AsyncLocalStorage<ContextState>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The scope the current async call chain runs under, or undefined outside any. */
export function getDatabaseContext(): Readonly<ContextScope> | undefined {
  return storage.getStore();
}

/**
 * Declare the organization the work in `work` belongs to. Opens no transaction
 * and touches no connection; database work inside opts in through
 * `withContextTransaction`. Background work (jobs, webhooks, consumers) uses
 * this to name its organization explicitly.
 */
export function runInOrganization<T>(organizationId: string, work: () => T): T {
  return storage.run({ kind: "organization", organizationId }, work);
}

/**
 * Run work that legitimately has no single organization (schedulers, startup,
 * cross-tenant routing). The reason is required so every such place is
 * searchable and says why. Inside it no organization setting is applied.
 */
export function runAsSystem<T>(reason: string, work: () => T): T {
  if (!reason.trim()) throw new Error("A system database context needs a reason");
  return storage.run({ kind: "system", reason }, work);
}

/**
 * Run database work in one short transaction whose `app.organization_id` is the
 * current context's organization. The setting is transaction-local
 * (`set_config(..., true)`), so it is gone at commit or rollback and cannot
 * reach the next user of the pooled connection. A system context sets nothing.
 *
 * Calls nested in the same context join the open transaction. Keep the work
 * short: no LLM or plugin HTTP calls inside, the connection is held throughout.
 */
export function withContextTransaction<T>(
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const state = storage.getStore();
  if (!state) {
    throw new Error("No database context: wrap the work in runInOrganization or runAsSystem");
  }
  if (state.manager) return work(state.manager);

  return AppDataSource.transaction(async (manager) => {
    if (state.kind === "organization") {
      if (!UUID.test(state.organizationId)) {
        throw new Error("Database context organization id is not a UUID");
      }
      await manager.query(`SELECT set_config($1, $2, true)`, [
        ORGANIZATION_SETTING,
        state.organizationId,
      ]);
    }
    return storage.run({ ...state, manager }, () => work(manager));
  });
}
