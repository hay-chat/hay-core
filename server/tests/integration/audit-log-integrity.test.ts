import "reflect-metadata";
import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { AuditLog } from "../../entities/audit-log.entity";
import { auditLogService } from "../../services/audit-log.service";
import { purgeAuditLogs } from "../helpers/audit-logs";

/**
 * DB-backed: append-only rows, organization deletion keeping the trail, the
 * anonymisation path erasure uses, and the retention purge all live in the
 * audit_logs trigger and FK, so a mock would only restate them.
 */
describe("audit log integrity", () => {
  const orgId = "a0d17000-0000-4000-8000-000000000001";
  const userId = "a0d17000-0000-4000-8000-0000000000aa";
  const audits = () => AppDataSource.getRepository(AuditLog);
  // original_organization_id is never selected by default (pre-migration compatibility).
  const originalOrg = async (id: string) =>
    (
      await AppDataSource.query(`SELECT original_organization_id FROM audit_logs WHERE id = $1`, [
        id,
      ])
    )[0]?.original_organization_id;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const users = AppDataSource.getRepository(User);
    if (!(await users.findOne({ where: { id: userId } }))) {
      await users.save(
        users.create({ id: userId, email: "audit-integrity@example.com", password: "x" }),
      );
    }
  });

  afterAll(async () => {
    await purgeAuditLogs("original_organization_id = $1 OR user_id = $2", [orgId, userId]);
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    await AppDataSource.getRepository(User).delete({ id: userId });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  async function freshOrg(): Promise<void> {
    const orgs = AppDataSource.getRepository(Organization);
    if (!(await orgs.findOne({ where: { id: orgId } }))) {
      await orgs.save(orgs.create({ id: orgId, name: "Audit Org", slug: "audit-integrity-org" }));
    }
  }

  it("rejects editing or deleting an audit row", async () => {
    await freshOrg();
    const log = await auditLogService.log({
      userId,
      organizationId: orgId,
      action: "agent.delete",
    });

    await expect(
      AppDataSource.query(`UPDATE audit_logs SET action = 'agent.create' WHERE id = $1`, [log.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      AppDataSource.query(`DELETE FROM audit_logs WHERE id = $1`, [log.id]),
    ).rejects.toThrow(/cannot be deleted/);
    expect((await audits().findOneByOrFail({ id: log.id })).action).toBe("agent.delete");
  });

  it("keeps the organization's trail, attributable, when the organization is deleted", async () => {
    await freshOrg();
    const log = await auditLogService.log({
      userId,
      organizationId: orgId,
      action: "agent.create",
    });
    expect(await originalOrg(log.id)).toBe(orgId);

    await AppDataSource.getRepository(Organization).delete({ id: orgId });

    const kept = await audits().findOneByOrFail({ id: log.id });
    expect(kept.organizationId).toBeNull();
    expect(await originalOrg(log.id)).toBe(orgId);
    expect(kept.action).toBe("agent.create");
  });

  it("allows erasure anonymisation but not rewriting the event", async () => {
    await freshOrg();
    const log = await auditLogService.log({
      userId,
      organizationId: orgId,
      action: "profile.update",
      ipAddress: "203.0.113.7",
      changes: { email: "someone@example.com" },
    });

    await expect(
      AppDataSource.query(
        `UPDATE audit_logs SET user_id = NULL, action = 'agent.create' WHERE id = $1`,
        [log.id],
      ),
    ).rejects.toThrow(/append-only/);

    const row = await audits().findOneByOrFail({ id: log.id });
    row.userId = null as unknown as undefined;
    row.ipAddress = "203.0.113.0";
    row.changes = { email: "[REDACTED]" };
    await audits().save(row);

    const anonymised = await audits().findOneByOrFail({ id: log.id });
    expect(anonymised.userId).toBeNull();
    expect(anonymised.ipAddress).toBe("203.0.113.0");
    expect(anonymised.action).toBe("profile.update");
  });

  it("purges only rows past retention through the retention job", async () => {
    const chainKey = randomUUID();
    // Inserts are allowed, so the expired row is written already backdated.
    const [{ id: oldId }] = await AppDataSource.query(
      `INSERT INTO audit_logs (original_organization_id, action, created_at)
       VALUES ($1, 'agent.update', now() - interval '366 days') RETURNING id`,
      [chainKey],
    );
    const [{ id: recentId }] = await AppDataSource.query(
      `INSERT INTO audit_logs (original_organization_id, action) VALUES ($1, 'agent.update') RETURNING id`,
      [chainKey],
    );

    expect(await auditLogService.cleanup()).toBeGreaterThanOrEqual(1);
    expect(await audits().findOneBy({ id: oldId })).toBeNull();
    expect(await audits().findOneBy({ id: recentId })).not.toBeNull();
  });

  describe("hash chain", () => {
    const insert = async (
      chainKey: string,
      ageDays: number,
    ): Promise<{ id: string; seq: string }> => {
      const [row] = await AppDataSource.query(
        `INSERT INTO audit_logs (original_organization_id, action, created_at)
         VALUES ($1, 'agent.update', now() - make_interval(days => $2))
         RETURNING id, chain_seq AS seq`,
        [chainKey, ageDays],
      );
      return row;
    };
    const asReplica = (sql: string, params: unknown[]) =>
      AppDataSource.transaction(async (manager) => {
        await manager.query(`SET LOCAL session_replication_role = replica`);
        await manager.query(sql, params);
      });

    it("links each row to the one before and verifies clean", async () => {
      const chainKey = randomUUID();
      const first = await insert(chainKey, 0);
      const second = await insert(chainKey, 0);

      expect([first.seq, second.seq]).toEqual(["1", "2"]);
      expect(await auditLogService.verifyChain(chainKey)).toEqual([]);
    });

    it("detects a rewritten event and a removed row behind the guard", async () => {
      const chainKey = randomUUID();
      const first = await insert(chainKey, 0);
      await insert(chainKey, 0);
      const third = await insert(chainKey, 0);
      const fourth = await insert(chainKey, 0);

      await asReplica(`UPDATE audit_logs SET action = 'user.login' WHERE id = $1`, [first.id]);
      await asReplica(`DELETE FROM audit_logs WHERE id = $1`, [third.id]);
      await asReplica(`DELETE FROM audit_logs WHERE id = $1`, [fourth.id]);

      const problems = (await auditLogService.verifyChain(chainKey)).map((p) => p.problem);
      expect(problems).toContain("hash_mismatch");
      expect(problems).toContain("missing_newest_rows");
    });

    it("detects a sequence gap in the middle of a chain", async () => {
      const chainKey = randomUUID();
      await insert(chainKey, 0);
      const middle = await insert(chainKey, 0);
      await insert(chainKey, 0);

      await asReplica(`DELETE FROM audit_logs WHERE id = $1`, [middle.id]);

      const problems = (await auditLogService.verifyChain(chainKey)).map((p) => p.problem);
      expect(problems).toContain("sequence_gap");
    });

    it("purges only a chain's oldest rows, and stays verifiable", async () => {
      const chainKey = randomUUID();
      const oldest = await insert(chainKey, 400);
      const inside = await insert(chainKey, 10);
      const expiredButLater = await insert(chainKey, 400);

      await auditLogService.cleanup();

      expect(await audits().findOneBy({ id: oldest.id })).toBeNull();
      expect(await audits().findOneBy({ id: inside.id })).not.toBeNull();
      expect(await audits().findOneBy({ id: expiredButLater.id })).not.toBeNull();
      expect(await auditLogService.verifyChain(chainKey)).toEqual([]);
    });

    it("clears personal fields after 90 days and keeps the chain valid", async () => {
      const chainKey = randomUUID();
      const [{ id }] = await AppDataSource.query(
        `INSERT INTO audit_logs (original_organization_id, action, ip_address, user_agent, changes, created_at)
         VALUES ($1, 'email.change', '198.51.100.9', 'jest', '{"newEmail":"a@example.com"}', now() - interval '91 days')
         RETURNING id`,
        [chainKey],
      );

      await auditLogService.cleanup();

      const [row] = await AppDataSource.query(
        `SELECT ip_address, user_agent, changes FROM audit_logs WHERE id = $1`,
        [id],
      );
      expect(row).toEqual({ ip_address: null, user_agent: null, changes: null });
      expect(await auditLogService.verifyChain(chainKey)).toEqual([]);
    });

    it("ignores chain values supplied by the writer", async () => {
      const chainKey = randomUUID();
      const [row] = await AppDataSource.query(
        `INSERT INTO audit_logs (original_organization_id, action, chain_seq, hash)
         VALUES ($1, 'agent.update', 999, 'forged') RETURNING chain_seq, hash`,
        [chainKey],
      );
      expect(row.chain_seq).toBe("1");
      expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("does not honour the purge flag for a role that doesn't own the table", async () => {
      const role = "audit_log_guard_test_role";
      const chainKey = randomUUID();
      const row = await insert(chainKey, 0);
      await AppDataSource.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
      await AppDataSource.query(`CREATE ROLE ${role}`);
      await AppDataSource.query(`GRANT SELECT, UPDATE, DELETE ON audit_logs TO ${role}`);
      try {
        await expect(
          AppDataSource.transaction(async (manager) => {
            await manager.query(`SET LOCAL ROLE ${role}`);
            await manager.query(`SELECT set_config('hay.audit_logs_purge', 'on', true)`);
            await manager.query(`DELETE FROM audit_logs WHERE id = $1`, [row.id]);
          }),
        ).rejects.toThrow(/cannot be deleted/);
      } finally {
        await AppDataSource.query(`REVOKE ALL ON audit_logs FROM ${role}`);
        await AppDataSource.query(`DROP ROLE ${role}`);
      }
      expect(await audits().findOneBy({ id: row.id })).not.toBeNull();
    });
  });

  it("records failed logins for unknown emails without storing the address", async () => {
    const email = "nobody-audit-integrity@example.com";
    const log = await auditLogService.logFailedLogin(email, "198.51.100.1", "jest");

    expect(log).not.toBeNull();
    const row = await audits().findOneByOrFail({ id: log!.id });
    expect(row.userId).toBeNull();
    expect(row.status).toBe("failure");
    expect(JSON.stringify(row)).not.toContain(email);
    expect(row.metadata?.emailHash).toMatch(/^[0-9a-f]{64}$/);
    await purgeAuditLogs("id = $1", [row.id]);
  });
});
