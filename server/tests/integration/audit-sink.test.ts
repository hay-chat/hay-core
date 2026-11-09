import "reflect-metadata";
import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { auditLogService } from "../../services/audit-log.service";
import {
  AUDIT_SINK_MAX_ATTEMPTS,
  AuditSinkService,
  auditSinkService,
  type AuditSinkStore,
} from "../../services/audit-sink.service";
import { purgeAuditLogs } from "../helpers/audit-logs";

/** In-memory stand-in for the bucket; `down` simulates an outage. */
class FakeStore implements AuditSinkStore {
  objects = new Map<string, string>();
  puts: string[] = [];
  down = false;
  async put(key: string, body: string): Promise<void> {
    if (this.down)
      throw Object.assign(new Error("connect ECONNREFUSED sink.internal"), {
        code: "ECONNREFUSED",
      });
    this.puts.push(key);
    if (!this.objects.has(key)) this.objects.set(key, body);
  }
  async *listKeys(): AsyncIterable<string> {
    yield* this.objects.keys();
  }
}

/** DB-backed: the outbox trigger, SKIP LOCKED claiming and the purge guard live in Postgres. */
describe("audit log external sink", () => {
  const chains: string[] = [];

  const insert = async (chainKey: string, ageDays = 0): Promise<{ id: string; seq: string }> => {
    if (!chains.includes(chainKey)) chains.push(chainKey);
    const [row] = await AppDataSource.query(
      `INSERT INTO audit_logs (original_organization_id, action, ip_address, created_at)
       VALUES ($1, 'agent.update', '198.51.100.7', now() - make_interval(days => $2))
       RETURNING id, chain_seq AS seq`,
      [chainKey, ageDays],
    );
    return row;
  };
  const outbox = async (id: string) =>
    (await AppDataSource.query(`SELECT * FROM audit_log_outbox WHERE audit_log_id = $1`, [id]))[0];
  const dueNow = (id: string) =>
    AppDataSource.query(
      `UPDATE audit_log_outbox SET next_attempt_at = now() WHERE audit_log_id = $1`,
      [id],
    );

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (chains.length) {
      await purgeAuditLogs("original_organization_id = ANY($1::uuid[])", [chains]);
      await AppDataSource.query(`DELETE FROM audit_log_outbox WHERE chain_key = ANY($1::uuid[])`, [
        chains,
      ]);
    }
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("queues a row in the transaction that writes it, and not when that rolls back", async () => {
    const chainKey = randomUUID();
    chains.push(chainKey);
    let rolledBackId = "";
    await expect(
      AppDataSource.transaction(async (manager) => {
        const [row] = await manager.query(
          `INSERT INTO audit_logs (original_organization_id, action) VALUES ($1, 'agent.update') RETURNING id`,
          [chainKey],
        );
        rolledBackId = row.id;
        expect(
          await manager.query(`SELECT 1 FROM audit_log_outbox WHERE audit_log_id = $1`, [
            rolledBackId,
          ]),
        ).toHaveLength(1);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await outbox(rolledBackId)).toBeUndefined();

    const committed = await insert(chainKey);
    expect(await outbox(committed.id)).toMatchObject({
      chain_seq: committed.seq,
      shipped_at: null,
    });
  });

  it("ships only fields the chain covers, under a key derived from the row", async () => {
    const store = new FakeStore();
    const chainKey = randomUUID();
    const row = await insert(chainKey);
    await new AuditSinkService(store).shipPending();

    const key = [...store.objects.keys()].find((k) => k.includes(chainKey))!;
    expect(key).toMatch(new RegExp(`${chainKey}/0{19}1-[0-9a-f]{64}\\.json$`));
    const body = JSON.parse(store.objects.get(key)!);
    expect(Object.keys(body).sort()).toEqual(
      [
        "action",
        "apiKeyId",
        "chainKey",
        "chainSeq",
        "createdAtMicros",
        "hash",
        "id",
        "originalOrganizationId",
        "prevHash",
        "resource",
        "status",
        "actorType",
        "v",
      ].sort(),
    );
    expect(body.id).toBe(row.id);
    expect(JSON.stringify(body)).not.toContain("198.51.100.7");
    expect((await outbox(row.id)).shipped_at).not.toBeNull();
  });

  it("keeps rows through an outage, never blocks the writer, and delivers once it ends", async () => {
    const store = new FakeStore();
    const sink = new AuditSinkService(store);
    const chainKey = randomUUID();
    store.down = true;

    const row = await insert(chainKey); // the write path doesn't touch the sink
    await sink.shipPending();
    const failed = await outbox(row.id);
    expect(failed).toMatchObject({ shipped_at: null, failed_at: null, attempts: 1 });
    expect(failed.last_error).not.toContain("sink.internal");
    expect(new Date(failed.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect((await sink.status()).pending).toBeGreaterThanOrEqual(1);

    store.down = false;
    await sink.shipPending();
    expect((await outbox(row.id)).shipped_at).toBeNull(); // backing off
    await dueNow(row.id);
    await sink.shipPending();
    expect((await outbox(row.id)).shipped_at).not.toBeNull();
    expect(store.puts.filter((k) => k.includes(chainKey))).toHaveLength(1);
  });

  it("sets an entry aside after the attempt limit, visibly, until it is requeued", async () => {
    const store = new FakeStore();
    const sink = new AuditSinkService(store);
    const row = await insert(randomUUID());
    store.down = true;
    await AppDataSource.query(`UPDATE audit_log_outbox SET attempts = $2 WHERE audit_log_id = $1`, [
      row.id,
      AUDIT_SINK_MAX_ATTEMPTS - 1,
    ]);
    await sink.shipPending();
    expect(await outbox(row.id)).toMatchObject({ failed_at: expect.any(Date), shipped_at: null });
    expect((await sink.status()).failed).toBeGreaterThanOrEqual(1);

    await sink.shipPending();
    expect((await outbox(row.id)).attempts).toBe(AUDIT_SINK_MAX_ATTEMPTS); // no longer retried

    store.down = false;
    expect(await sink.requeueFailed()).toBeGreaterThanOrEqual(1);
    await sink.shipPending();
    expect((await outbox(row.id)).shipped_at).not.toBeNull();
  });

  it("is idempotent when an entry is delivered again, and with two replicas shipping at once", async () => {
    const store = new FakeStore();
    const chainKey = randomUUID();
    const rows = [];
    for (let i = 0; i < 12; i++) rows.push(await insert(chainKey));

    await Promise.all([
      new AuditSinkService(store).shipPending(),
      new AuditSinkService(store).shipPending(),
    ]);
    const mine = store.puts.filter((k) => k.includes(chainKey));
    expect(mine).toHaveLength(12);
    expect(new Set(mine).size).toBe(12);

    // Replay: the same entries marked unshipped go to the same keys.
    await AppDataSource.query(
      `UPDATE audit_log_outbox SET shipped_at = NULL, next_attempt_at = now() WHERE chain_key = $1`,
      [chainKey],
    );
    await new AuditSinkService(store).shipPending();
    expect([...store.objects.keys()].filter((k) => k.includes(chainKey))).toHaveLength(12);
  });

  describe("retention", () => {
    it("keeps expired rows that have not shipped, and the later rows of their chain", async () => {
      const chainKey = randomUUID();
      const shippedOld = await insert(chainKey, 400);
      const unshippedOld = await insert(chainKey, 400);
      const laterOld = await insert(chainKey, 400);
      await AppDataSource.query(
        `UPDATE audit_log_outbox SET shipped_at = now() WHERE audit_log_id = $1`,
        [shippedOld.id],
      );
      jest.spyOn(auditSinkService, "enabled", "get").mockReturnValue(true);

      await auditLogService.cleanup();

      const remaining = async (id: string) =>
        (await AppDataSource.query(`SELECT 1 FROM audit_logs WHERE id = $1`, [id])).length;
      expect(await remaining(shippedOld.id)).toBe(0);
      expect(await outbox(shippedOld.id)).toBeUndefined();
      expect(await remaining(unshippedOld.id)).toBe(1);
      expect(await remaining(laterOld.id)).toBe(1);
      expect(await auditLogService.verifyChain(chainKey)).toEqual([]);

      await AppDataSource.query(
        `UPDATE audit_log_outbox SET shipped_at = now() WHERE chain_key = $1`,
        [chainKey],
      );
      await auditLogService.cleanup();
      expect(await remaining(unshippedOld.id)).toBe(0);
      expect(await remaining(laterOld.id)).toBe(0);
    });

    it("does not let an unconfigured sink hold retention back", async () => {
      const chainKey = randomUUID();
      const old = await insert(chainKey, 400);
      await auditLogService.cleanup();
      expect(
        await AppDataSource.query(`SELECT 1 FROM audit_logs WHERE id = $1`, [old.id]),
      ).toHaveLength(0);
    });
  });

  describe("verify", () => {
    it("is clean after shipping, ignores lag, and reports what differs", async () => {
      const store = new FakeStore();
      const sink = new AuditSinkService(store);
      const chainKey = randomUUID();
      const first = await insert(chainKey);
      await insert(chainKey);
      await sink.shipPending();
      const lagging = await insert(chainKey);

      expect(await sink.verify(chainKey)).toEqual({ checked: 3, pending: 1, problems: [] });
      expect(lagging.seq).toBe("3");

      const firstKey = [...store.objects.keys()].find((k) =>
        k.includes(`${chainKey}/${"1".padStart(20, "0")}-`),
      )!;
      store.objects.delete(firstKey);
      const forged = `audit-log/${chainKey}/${"2".padStart(20, "0")}-${"f".repeat(64)}.json`;
      store.objects.set(forged, "{}");
      store.objects.set(
        `audit-log/${chainKey}/${"9".padStart(20, "0")}-${"a".repeat(64)}.json`,
        "{}",
      );

      const problems = (await sink.verify(chainKey)).problems
        .map((p) => `${p.chainSeq}:${p.problem}`)
        .sort();
      expect(problems).toEqual(["1:missing_in_sink", "2:sink_conflict", "9:missing_in_db"]);
      expect(first.seq).toBe("1");
    });

    it("accepts objects for rows that retention removed", async () => {
      const store = new FakeStore();
      const sink = new AuditSinkService(store);
      const chainKey = randomUUID();
      await insert(chainKey, 400);
      await insert(chainKey, 0);
      await sink.shipPending();
      await auditLogService.cleanup();

      expect(await sink.verify(chainKey)).toEqual({ checked: 1, pending: 0, problems: [] });
    });
  });
});
