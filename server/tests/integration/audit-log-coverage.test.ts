import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { AuditLog } from "../../entities/audit-log.entity";
import { apiTokensRouter } from "../../routes/v1/api-tokens";
import { ApiTokenScope } from "../../types/api-token-scopes";
import { organizationService } from "../../services/organization.service";
import type { Context } from "../../trpc/context";
import { purgeAuditLogs } from "../helpers/audit-logs";

/** DB-backed: the audit rows API key and organization lifecycle events must leave. */
describe("audit log coverage", () => {
  const orgId = "a0d17000-0000-4000-8000-000000000002";
  const userId = "a0d17000-0000-4000-8000-0000000000bb";
  const ctx = {
    user: { id: userId, hasScope: () => true, getRole: () => "owner" },
    organizationId: orgId,
    ipAddress: "198.51.100.2",
    userAgent: "jest",
    req: { headers: {} },
    res: {},
  } as unknown as Context;
  const actions = async () =>
    (
      await AppDataSource.getRepository(AuditLog).find({
        where: { originalOrganizationId: orgId },
        order: { createdAt: "ASC" },
      })
    ).map((log) => log.action);

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const users = AppDataSource.getRepository(User);
    if (!(await users.findOne({ where: { id: userId } }))) {
      await users.save(
        users.create({ id: userId, email: "audit-coverage@example.com", password: "x" }),
      );
    }
    const orgs = AppDataSource.getRepository(Organization);
    if (!(await orgs.findOne({ where: { id: orgId } }))) {
      await orgs.save(orgs.create({ id: orgId, name: "Coverage Org", slug: "audit-coverage-org" }));
    }
  });

  afterAll(async () => {
    await purgeAuditLogs("original_organization_id = $1", [orgId]);
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    await AppDataSource.getRepository(User).delete({ id: userId });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("records API key creation, revocation and deletion without the secret", async () => {
    const caller = apiTokensRouter.createCaller(ctx);
    const created = await caller.create({ name: "CI key", scopes: [ApiTokenScope.CONVERSATIONS_READ] });
    await caller.revoke({ id: created.id });
    await caller.delete({ id: created.id });

    expect(await actions()).toEqual(["apikey.create", "apikey.revoke", "apikey.revoke"]);
    const rows = await AppDataSource.getRepository(AuditLog).find({
      where: { originalOrganizationId: orgId },
    });
    expect(rows.every((row) => row.userId === userId && row.ipAddress === "198.51.100.2")).toBe(
      true,
    );
    expect(JSON.stringify(rows)).not.toContain(created.token);
  });

  it("records the organization's deletion and keeps the trail afterwards", async () => {
    const organization = await AppDataSource.getRepository(Organization).findOneByOrFail({
      id: orgId,
    });
    await organizationService.deleteWithData(organization, { userId, source: "owner" });

    const trail = await actions();
    expect(trail).toContain("apikey.create");
    expect(trail[trail.length - 1]).toBe("organization.delete");
  });
});
