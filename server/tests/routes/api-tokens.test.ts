import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { AppDataSource } from "@server/database/data-source";
import { ApiKey } from "@server/entities/apikey.entity";
import { Organization } from "@server/entities/organization.entity";
import { User } from "@server/entities/user.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { AuthUser } from "@server/lib/auth/AuthUser";
import { authenticateApiKeyAuth } from "@server/lib/auth/middleware/apiKeyAuth";
import { apiTokensRouter } from "@server/routes/v1/api-tokens";
import { ApiTokenScope } from "@server/types/api-token-scopes";
import type { Context } from "@server/trpc/context";

describe("apiTokens", () => {
  const organizationId = "d1900000-0000-4000-8000-000000000001";
  const userId = "d1900000-0000-4000-8000-000000000002";
  let caller: ReturnType<typeof apiTokensRouter.createCaller>;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.getRepository(User).delete({ id: userId });
    await AppDataSource.getRepository(Organization).delete({ id: organizationId });
    await AppDataSource.getRepository(Organization).save(
      AppDataSource.getRepository(Organization).create({
        id: organizationId,
        name: "Token org",
        slug: "token-org-d19",
      }),
    );
    const user = await AppDataSource.getRepository(User).save(
      AppDataSource.getRepository(User).create({
        id: userId,
        email: "token-owner@example.com",
        password: "x",
        isActive: true,
        emailVerified: true,
      }),
    );
    const userOrganization = Object.assign(new UserOrganization(), {
      role: "owner",
      isActive: true,
    });
    caller = apiTokensRouter.createCaller({
      user: new AuthUser(user, "jwt", { organizationId, userOrganization }),
      organizationId,
      req: { headers: {} },
      res: {},
      ipAddress: "203.0.113.9",
      userAgent: "jest",
    } as unknown as Context);
  });

  afterAll(async () => {
    await AppDataSource.getRepository(Organization).delete({ id: organizationId });
    await AppDataSource.getRepository(User).delete({ id: userId });
  });

  it("expires in a year by default and shows the token's real prefix", async () => {
    const created = await caller.create({
      name: "default",
      scopes: [ApiTokenScope.CUSTOMERS_READ],
    });

    const yearFromNow = Date.now() + 365 * 24 * 60 * 60 * 1000;
    expect(Math.abs(created.expiresAt!.getTime() - yearFromNow)).toBeLessThan(60_000);

    const listed = (await caller.list()).find((token) => token.id === created.id);
    expect(listed?.maskedKey).toBe(`${created.token.slice(0, 8)}****`);
    const byId = await caller.getById({ id: created.id });
    expect(byId.maskedKey).toBe(`${created.token.slice(0, 8)}****`);
  });

  it("keeps an explicit expiry and records the creator", async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const created = await caller.create({ name: "explicit", scopes: [], expiresAt });
    expect(created.expiresAt).toEqual(expiresAt);

    const row = await AppDataSource.getRepository(ApiKey)
      .createQueryBuilder("key")
      .addSelect("key.createdByUserId")
      .where("key.id = :id", { id: created.id })
      .getOneOrFail();
    expect(row.createdByUserId).toBe(userId);
  });

  it("authenticates a new token and records its use without rewriting the row", async () => {
    const created = await caller.create({
      name: "used",
      scopes: [ApiTokenScope.CUSTOMERS_READ],
    });

    const authUser = await authenticateApiKeyAuth(`ApiKey ${created.token}`);

    expect(authUser?.apiKeyId).toBe(created.id);
    const row = await AppDataSource.getRepository(ApiKey).findOneByOrFail({ id: created.id });
    expect(row.lastUsedAt).toBeTruthy();
  });
});
