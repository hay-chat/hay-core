import "reflect-metadata";
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
    expect((await audits().findOneByOrFail({ id: log.id })).originalOrganizationId).toBe(orgId);

    await AppDataSource.getRepository(Organization).delete({ id: orgId });

    const kept = await audits().findOneByOrFail({ id: log.id });
    expect(kept.organizationId).toBeNull();
    expect(kept.originalOrganizationId).toBe(orgId);
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
    await freshOrg();
    const old = await auditLogService.log({
      userId,
      organizationId: orgId,
      action: "agent.update",
    });
    const recent = await auditLogService.log({
      userId,
      organizationId: orgId,
      action: "agent.update",
    });
    // Backdating needs the guard off for a moment (test-only).
    await AppDataSource.transaction(async (manager) => {
      await manager.query(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_guard`);
      await manager.query(
        `UPDATE audit_logs SET created_at = now() - interval '91 days' WHERE id = $1`,
        [old.id],
      );
      await manager.query(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_guard`);
    });

    expect(await auditLogService.cleanup()).toBeGreaterThanOrEqual(1);
    expect(await audits().findOneBy({ id: old.id })).toBeNull();
    expect(await audits().findOneBy({ id: recent.id })).not.toBeNull();
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
