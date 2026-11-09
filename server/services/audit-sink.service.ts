import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  type ObjectLockMode,
} from "@aws-sdk/client-s3";
import { config } from "../config/env";
import { AppDataSource } from "../database/data-source";
import {
  allowStorageWaitInTransaction,
  withLongStatementTimeout,
} from "../database/session-limits";
import { createLogger } from "@server/lib/logger";
import { metrics, registerCollector } from "@server/lib/metrics";

const logger = createLogger("audit-sink");

const POSTGRES_UNDEFINED_TABLE = "42P01";
const BATCH_SIZE = 50;
const PUT_CONCURRENCY = 5;
const MAX_BATCHES_PER_RUN = 20;
const VERIFY_PAGE_SIZE = 5000;
/** After this many failed attempts an entry stops retrying and waits for an operator. */
export const AUDIT_SINK_MAX_ATTEMPTS = 20;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 60 * 60_000;
const PRECONDITION_FAILED = 412;

/** What the sink needs from object storage; the S3 implementation below is the only one in production. */
export interface AuditSinkStore {
  /** Stores the object once. Writing a key that already exists is not an error. */
  put(key: string, body: string): Promise<void>;
  listKeys(): AsyncIterable<string>;
}

export interface AuditChainProblemInSink {
  chainKey: string;
  chainSeq: string;
  problem: "missing_in_sink" | "hash_mismatch" | "sink_conflict" | "missing_in_db";
}

export interface AuditSinkVerifyReport {
  /** Rows of audit_logs compared. */
  checked: number;
  /** Rows not shipped yet, which is lag, not a mismatch. */
  pending: number;
  problems: AuditChainProblemInSink[];
}

interface OutboxRow {
  audit_log_id: string;
  attempts: number;
  chain_key: string;
  chain_seq: string;
  hash: string | null;
  payload: Record<string, unknown> | null;
}

/**
 * Only fields the hash chain already covers. No user id, address, user agent,
 * changes or metadata: the copy can't be used to read personal data and needs
 * no erasure.
 */
const PAYLOAD_SQL = `jsonb_build_object(
  'v', 1,
  'id', l.id,
  'chainKey', l.chain_key,
  'chainSeq', l.chain_seq::text,
  'prevHash', l.prev_hash,
  'hash', l.hash,
  'createdAtMicros', (extract(epoch FROM l.created_at) * 1000000)::bigint::text,
  'action', l.action,
  'resource', l.resource,
  'originalOrganizationId', l.original_organization_id,
  'status', l.status,
  'actorType', l.actor_type,
  'apiKeyId', l.api_key_id
)`;

export function auditSinkKey(prefix: string, chainKey: string, chainSeq: string, hash: string) {
  return `${prefix}${chainKey}/${chainSeq.padStart(20, "0")}-${hash}.json`;
}

function isUndefinedTable(error: unknown): boolean {
  return (error as { code?: string }).code === POSTGRES_UNDEFINED_TABLE;
}

/** Error class and status only: a message can carry hostnames or key ids. */
function describeFailure(error: unknown): string {
  const e = error as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  return [e.name ?? "Error", e.code, e.$metadata?.httpStatusCode]
    .filter(Boolean)
    .join(":")
    .slice(0, 200);
}

export function retryDelayMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);
}

export function createS3AuditSinkStore(): AuditSinkStore {
  const sink = config.auditSink;
  const client = new S3Client({
    endpoint: sink.endpoint ?? undefined,
    region: sink.region,
    forcePathStyle: sink.forcePathStyle,
    credentials:
      sink.accessKeyId && sink.secretAccessKey
        ? { accessKeyId: sink.accessKeyId, secretAccessKey: sink.secretAccessKey }
        : undefined,
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 5000, requestTimeout: 20000 },
  });
  return {
    async put(key, body) {
      const retainUntil = new Date(Date.now() + sink.retentionDays * 24 * 60 * 60 * 1000);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: sink.bucket!,
            Key: key,
            Body: body,
            ContentType: "application/json",
            // The key holds the hash, so an existing object is the same event: never rewrite it.
            IfNoneMatch: "*",
            ObjectLockMode: sink.lockMode as ObjectLockMode,
            ObjectLockRetainUntilDate: retainUntil,
          }),
        );
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ===
          PRECONDITION_FAILED
        ) {
          return;
        }
        throw error;
      }
    },
    async *listKeys() {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: sink.bucket!,
            Prefix: sink.prefix,
            ContinuationToken: token,
          }),
        );
        for (const object of page.Contents ?? []) if (object.Key) yield object.Key;
        token = page.NextContinuationToken;
      } while (token);
    },
  };
}

export class AuditSinkService {
  private store?: AuditSinkStore;

  constructor(store?: AuditSinkStore) {
    this.store = store;
  }

  get enabled(): boolean {
    return this.store !== undefined || Boolean(config.auditSink.bucket);
  }

  private getStore(): AuditSinkStore {
    if (!this.store) {
      if (!config.auditSink.bucket) throw new Error("The audit log sink is not configured");
      this.store = createS3AuditSinkStore();
    }
    return this.store;
  }

  /**
   * Ships due outbox entries. Safe to run on several replicas at once: entries
   * are claimed with SKIP LOCKED, and a repeated upload of an entry is harmless
   * because the object key is derived from the row.
   */
  async shipPending(): Promise<{ shipped: number; failed: number }> {
    if (!this.enabled) return { shipped: 0, failed: 0 };
    const totals = { shipped: 0, failed: 0 };
    try {
      for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
        const batch = await this.shipBatch();
        totals.shipped += batch.shipped;
        totals.failed += batch.failed;
        if (batch.claimed < BATCH_SIZE) break;
      }
    } catch (error) {
      if (isUndefinedTable(error)) {
        logger.warn("Audit log shipping skipped until the migrations have run");
        return totals;
      }
      throw error;
    }
    return totals;
  }

  private async shipBatch(): Promise<{ claimed: number; shipped: number; failed: number }> {
    const store = this.getStore();
    const prefix = config.auditSink.prefix;
    return withLongStatementTimeout(async (manager) => {
      await allowStorageWaitInTransaction(manager);
      const rows: OutboxRow[] = await manager.query(
        `SELECT o.audit_log_id, o.attempts, o.chain_key, o.chain_seq::text AS chain_seq,
                l.hash, ${PAYLOAD_SQL} AS payload
         FROM audit_log_outbox o
         LEFT JOIN audit_logs l ON l.id = o.audit_log_id
         WHERE o.shipped_at IS NULL AND o.failed_at IS NULL AND o.next_attempt_at <= now()
         ORDER BY o.next_attempt_at, o.chain_key, o.chain_seq
         LIMIT $1
         FOR UPDATE OF o SKIP LOCKED`,
        [BATCH_SIZE],
      );

      const outcomes: Array<Awaited<ReturnType<AuditSinkService["shipRow"]>>> = [];
      for (let i = 0; i < rows.length; i += PUT_CONCURRENCY) {
        outcomes.push(
          ...(await Promise.all(
            rows.slice(i, i + PUT_CONCURRENCY).map((row) => this.shipRow(store, prefix, row)),
          )),
        );
      }
      // One connection runs one query at a time, so results are recorded in order.
      for (const [index, outcome] of outcomes.entries()) {
        await this.recordOutcome(manager, rows[index], outcome);
      }
      const shipped = outcomes.filter((o) => o.status === "shipped").length;
      const failed = outcomes.filter((o) => o.status === "failed").length;
      return { claimed: rows.length, shipped, failed };
    });
  }

  private async shipRow(
    store: AuditSinkStore,
    prefix: string,
    row: OutboxRow,
  ): Promise<{ status: "shipped" } | { status: "retry" | "failed"; error: string }> {
    if (!row.payload || !row.hash) {
      // The audit row is gone, so there is nothing to copy and retrying can't help.
      return { status: "failed", error: "audit_row_missing" };
    }
    try {
      await store.put(
        auditSinkKey(prefix, row.chain_key, row.chain_seq, row.hash),
        JSON.stringify(row.payload),
      );
      return { status: "shipped" };
    } catch (error) {
      const terminal = row.attempts + 1 >= AUDIT_SINK_MAX_ATTEMPTS;
      return { status: terminal ? "failed" : "retry", error: describeFailure(error) };
    }
  }

  private async recordOutcome(
    manager: { query: (sql: string, params: unknown[]) => Promise<unknown> },
    row: OutboxRow,
    outcome: Awaited<ReturnType<AuditSinkService["shipRow"]>>,
  ): Promise<void> {
    metrics.auditSinkDeliveries.inc({ outcome: outcome.status });
    if (outcome.status === "shipped") {
      await manager.query(
        `UPDATE audit_log_outbox SET shipped_at = now(), attempts = attempts + 1, last_error = NULL
         WHERE audit_log_id = $1`,
        [row.audit_log_id],
      );
      return;
    }
    if (outcome.status === "failed") {
      logger.error(
        { auditLogId: row.audit_log_id, attempts: row.attempts + 1, error: outcome.error },
        "Audit log entry could not be shipped and was set aside",
      );
    }
    await manager.query(
      `UPDATE audit_log_outbox
       SET attempts = attempts + 1, last_error = $2,
           next_attempt_at = now() + make_interval(secs => $3),
           failed_at = CASE WHEN $4 THEN now() ELSE NULL END
       WHERE audit_log_id = $1`,
      [
        row.audit_log_id,
        outcome.error,
        retryDelayMs(row.attempts + 1) / 1000,
        outcome.status === "failed",
      ],
    );
  }

  /** Puts entries that used up their attempts back in the queue. */
  async requeueFailed(): Promise<number> {
    const result: Array<{ audit_log_id: string }> = await AppDataSource.query(
      `UPDATE audit_log_outbox
       SET failed_at = NULL, attempts = 0, next_attempt_at = now()
       WHERE failed_at IS NOT NULL AND shipped_at IS NULL
       RETURNING audit_log_id`,
    );
    return result.length;
  }

  async status(): Promise<{ pending: number; failed: number; oldestPendingSeconds: number }> {
    const [row] = await AppDataSource.query(
      `SELECT count(*) FILTER (WHERE failed_at IS NULL) AS pending,
              count(*) FILTER (WHERE failed_at IS NOT NULL) AS failed,
              COALESCE(extract(epoch FROM now() - min(queued_at) FILTER (WHERE failed_at IS NULL)), 0) AS oldest
       FROM audit_log_outbox WHERE shipped_at IS NULL`,
    );
    return {
      pending: Number(row.pending),
      failed: Number(row.failed),
      oldestPendingSeconds: Math.round(Number(row.oldest)),
    };
  }

  /**
   * Compares the sink with audit_logs. Object keys carry the chain, sequence and
   * hash, so listing is enough: a row whose hash differs from the shipped one, a
   * shipped row that is gone, and an unexpected object are all visible. Objects
   * at or below a chain's purged_through belong to rows retention removed.
   * TODO: stream the comparison per chain if the trail grows past memory.
   */
  async verify(onlyChain?: string): Promise<AuditSinkVerifyReport> {
    const prefix = config.auditSink.prefix;
    const pattern = new RegExp(
      `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([0-9a-f-]{36})/(\\d{20})-([0-9a-f]{64})\\.json$`,
    );
    const inSink = new Map<string, Set<string>>();
    for await (const key of this.getStore().listKeys()) {
      const match = pattern.exec(key);
      if (!match || (onlyChain && match[1] !== onlyChain)) continue;
      const id = `${match[1]}:${BigInt(match[2])}`;
      (inSink.get(id) ?? inSink.set(id, new Set()).get(id)!).add(match[3]);
    }

    const problems: AuditChainProblemInSink[] = [];
    const seen = new Set<string>();
    let checked = 0;
    let pending = 0;
    let after: { chainKey: string; chainSeq: string } | null = null;

    for (;;) {
      const rows: Array<{
        chain_key: string;
        chain_seq: string;
        hash: string;
        shipped_at: Date | null;
      }> = await withLongStatementTimeout((manager) =>
        manager.query(
          `SELECT l.chain_key, l.chain_seq::text AS chain_seq, l.hash, o.shipped_at
           FROM audit_logs l
           LEFT JOIN audit_log_outbox o ON o.audit_log_id = l.id
           WHERE l.chain_seq IS NOT NULL
             AND ($4::uuid IS NULL OR l.chain_key = $4::uuid)
             AND ($1::uuid IS NULL OR (l.chain_key, l.chain_seq) > ($1::uuid, $2::bigint))
           ORDER BY l.chain_key, l.chain_seq
           LIMIT $3`,
          [after?.chainKey ?? null, after?.chainSeq ?? null, VERIFY_PAGE_SIZE, onlyChain ?? null],
        ),
      );
      for (const row of rows) {
        checked++;
        const id = `${row.chain_key}:${row.chain_seq}`;
        seen.add(id);
        const hashes = inSink.get(id);
        const problem = (name: AuditChainProblemInSink["problem"]) =>
          problems.push({ chainKey: row.chain_key, chainSeq: row.chain_seq, problem: name });
        if (!hashes) {
          if (row.shipped_at) problem("missing_in_sink");
          else pending++;
        } else if (hashes.size > 1) {
          problem("sink_conflict");
        } else if (!hashes.has(row.hash)) {
          problem("hash_mismatch");
        }
      }
      if (rows.length < VERIFY_PAGE_SIZE) break;
      const last = rows[rows.length - 1];
      after = { chainKey: last.chain_key, chainSeq: last.chain_seq };
    }

    const heads: Array<{ chain_key: string; purged_through: string }> = await AppDataSource.query(
      `SELECT chain_key, purged_through::text AS purged_through FROM audit_log_chain_heads
       WHERE $1::uuid IS NULL OR chain_key = $1::uuid`,
      [onlyChain ?? null],
    );
    const purgedThrough = new Map(heads.map((h) => [h.chain_key, BigInt(h.purged_through)]));
    for (const id of inSink.keys()) {
      if (seen.has(id)) continue;
      const [chainKey, seq] = id.split(":");
      if (BigInt(seq) > (purgedThrough.get(chainKey) ?? 0n)) {
        problems.push({ chainKey, chainSeq: seq, problem: "missing_in_db" });
      }
    }
    return { checked, pending, problems };
  }
}

export const auditSinkService = new AuditSinkService();

/** Queue depth, age and failures, read at scrape time. Reports nothing while the sink is off. */
export function registerAuditSinkMetrics(): void {
  const read = async () => (auditSinkService.enabled ? auditSinkService.status() : null);
  registerCollector("hay_audit_sink_pending", "Audit entries waiting to be shipped.", async () => {
    const s = await read();
    return s ? s.pending : [];
  });
  registerCollector(
    "hay_audit_sink_oldest_pending_seconds",
    "Age of the oldest audit entry not yet shipped.",
    async () => {
      const s = await read();
      return s ? s.oldestPendingSeconds : [];
    },
  );
  registerCollector(
    "hay_audit_sink_failed",
    "Audit entries set aside after repeated failures; they need an operator.",
    async () => {
      const s = await read();
      return s ? s.failed : [];
    },
  );
}
