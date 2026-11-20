import { PostgresQueryRunner } from "typeorm/driver/postgres/PostgresQueryRunner";
import { config } from "../config/env";
import { ROLE_NAME } from "./app-role";
import { ORGANIZATION_SETTING, getDatabaseContext } from "./organization-context";

/**
 * Makes every query pick up `app.organization_id` from the database context
 * without changing call sites, and without extra round trips in steady state.
 *
 * The value is kept at session level on the pooled connection, and the value
 * last applied to each physical pg connection is remembered (keyed on the pg
 * client, not the query runner). The wanted state has three values: an
 * organization, none (no context), or system. System work runs as the system
 * database role (`config.database.systemRole`, which policies can name), no
 * context runs as the connecting role with an empty organization, so the two
 * are different states. Before a statement, `stream()`, or the outermost BEGIN,
 * the wanted state is compared with that record:
 *
 * - equal: nothing extra is sent;
 * - different: one statement setting both `app.organization_id` and `role`
 *   (`set_config(..., false)`) is sent first and the record updated. An
 *   organization or no context clears the role.
 *
 * There is no clear on release: every use compares and corrects, so no-context
 * work on a connection last used by an organization or by system work resets
 * it first. A new connection has no record and counts as none.
 *
 * Invariants:
 * - The value is only ever set outside a transaction (the runner is not in one
 *   and the pg client reports an idle transaction status), because a
 *   session-level set inside a transaction is undone by ROLLBACK. Work that
 *   enters another organization inside an open transaction keeps the
 *   transaction's organization.
 * - Transaction control or session resets sent through `query()` that the runner
 *   did not issue itself (BEGIN, COMMIT, ROLLBACK, SAVEPOINT, RESET ALL,
 *   DISCARD, SET ROLE, ...) mark the connection's record unknown, so the next
 *   use sets the value again.
 * - A failed set marks the record unknown and throws, so the statement never
 *   runs under the wrong organization.
 * - A runner outside a transaction serves one context; a query from any other
 *   context throws before anything is sent.
 */

/** The pg client surface used here; its transaction status is 'I' (idle), 'T' or 'E'. */
interface PgConnection {
  query(sql: string): Promise<unknown>;
  getTransactionStatus(): string | null;
}

type QueryFn = PostgresQueryRunner["query"];
type StreamFn = PostgresQueryRunner["stream"];
type StartFn = PostgresQueryRunner["startTransaction"];
type CommitFn = PostgresQueryRunner["commitTransaction"];
type RollbackFn = PostgresQueryRunner["rollbackTransaction"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Transaction control sent as a statement. */
const TRANSACTION_CONTROL =
  /^\s*(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction|commit\s+prepared|rollback\s+prepared)\b/i;

/** Statements that can change or drop session state, including the setting. */
const SESSION_RESET = /^\s*(reset|discard|set\s+(session\s+)?(role|session\s+authorization))\b/i;

const UNKNOWN = Symbol("unknown");
type Applied = string | typeof UNKNOWN;

const NONE = "none";
const SYSTEM = "system";

/** State last applied on each physical connection; absent means never set (none). */
const applied = new WeakMap<object, Applied>();

/** The context each runner serves; the compare and the send are only safe for one context per runner. */
const runnerContext = new WeakMap<PostgresQueryRunner, string>();

/** Runners currently executing their own transaction control, which keeps state known. */
const issuingControl = new WeakSet<PostgresQueryRunner>();

/** The wanted state: `org:<uuid>`, `none` or `system`. */
function wantedState(): string {
  const scope = getDatabaseContext();
  if (!scope) return NONE;
  if (scope.kind === "system") return SYSTEM;
  if (!UUID.test(scope.organizationId)) {
    throw new Error("Database context organization id is not a UUID");
  }
  return `org:${scope.organizationId}`;
}

/** The single statement that moves a connection to `state`. */
function applyStatement(state: string): string {
  const organization = state.startsWith("org:") ? state.slice(4) : "";
  const role = state === SYSTEM ? config.database.systemRole : "none";
  if (!ROLE_NAME.test(role)) throw new Error("Invalid database system role name");
  // The id is a validated UUID (or empty) and the role a validated name, so inlining keeps this a simple-protocol call.
  return `SELECT set_config('${ORGANIZATION_SETTING}', '${organization}', false), set_config('role', '${role}', false)`;
}

/** Bring the connection's setting to the wanted value, sending nothing if it already is. */
async function align(runner: PostgresQueryRunner): Promise<PgConnection> {
  const connection = (await runner.connect()) as unknown as PgConnection;
  // Inside a transaction the setting stays as it was before BEGIN.
  if (runner.isTransactionActive || connection.getTransactionStatus() !== "I") return connection;

  const wanted = wantedState();
  const servedContext = runnerContext.get(runner);
  if (servedContext !== undefined && servedContext !== wanted) {
    throw new Error("A query runner outside a transaction cannot change organization context");
  }
  runnerContext.set(runner, wanted);

  const current = applied.get(connection) ?? NONE;
  if (current === wanted) return connection;

  applied.set(connection, UNKNOWN);
  await connection.query(applyStatement(wanted));
  applied.set(connection, wanted);
  return connection;
}

function markUnknown(connection: PgConnection): void {
  applied.set(connection, UNKNOWN);
}

export function installOrganizationContextHook(
  enabled: boolean = config.database.orgContextHook,
): () => void {
  if (!enabled) return () => undefined;
  // The hook keeps the organization at session level on each connection. A
  // transaction pooler hands a different server session to every transaction,
  // so the two cannot run together.
  if (config.database.transactionPooler) {
    throw new Error(
      "DB_ORG_CONTEXT_HOOK cannot be used with DB_TRANSACTION_POOLER: the organization setting is kept per session",
    );
  }

  const proto = PostgresQueryRunner.prototype;
  const originalQuery: QueryFn = proto.query;
  const originalStream: StreamFn = proto.stream;
  const originalStart: StartFn = proto.startTransaction;
  const originalCommit: CommitFn = proto.commitTransaction;
  const originalRollback: RollbackFn = proto.rollbackTransaction;

  proto.query = async function (this: PostgresQueryRunner, query, parameters, structured) {
    if (this.isReleased || issuingControl.has(this)) {
      return originalQuery.call(this, query, parameters, structured);
    }
    const connection = await align(this);
    const reset = TRANSACTION_CONTROL.test(query) || SESSION_RESET.test(query);
    try {
      return await originalQuery.call(this, query, parameters, structured);
    } finally {
      if (reset) markUnknown(connection);
    }
  } as QueryFn;

  proto.stream = async function (this: PostgresQueryRunner, query, parameters, onEnd, onError) {
    if (!this.isReleased) await align(this);
    return originalStream.call(this, query, parameters, onEnd, onError);
  } as StreamFn;

  const ownControl = <A extends unknown[], R>(
    original: (this: PostgresQueryRunner, ...args: A) => Promise<R>,
  ) =>
    async function (this: PostgresQueryRunner, ...args: A): Promise<R> {
      issuingControl.add(this);
      try {
        return await original.apply(this, args);
      } finally {
        issuingControl.delete(this);
      }
    };

  proto.startTransaction = async function (this: PostgresQueryRunner, isolationLevel) {
    // Only the outermost BEGIN needs the value; savepoints stay inside it.
    if (this.transactionDepth === 0 && !this.isReleased) await align(this);
    return ownControl(originalStart).call(this, isolationLevel);
  } as StartFn;
  proto.commitTransaction = ownControl(originalCommit) as CommitFn;
  proto.rollbackTransaction = ownControl(originalRollback) as RollbackFn;

  return () => {
    proto.query = originalQuery;
    proto.stream = originalStream;
    proto.startTransaction = originalStart;
    proto.commitTransaction = originalCommit;
    proto.rollbackTransaction = originalRollback;
  };
}
