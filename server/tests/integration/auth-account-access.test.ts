/**
 * Account access: signup issues no session before email verification, signup
 * and email-change tokens are kept apart, auth codes are single-use and only
 * issued for allowlisted destinations, and only owners hand out the owner role.
 */
import "reflect-metadata";
import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from "@jest/globals";
import * as crypto from "crypto";
import { In } from "typeorm";

const mockSendTemplateEmail = jest.fn(async (..._args: unknown[]) => ({ success: true }));
jest.mock("../../services/email.service", () => ({
  emailService: {
    initialize: async () => undefined,
    sendTemplateEmail: (...args: unknown[]) => mockSendTemplateEmail(...args),
  },
  getOrganizationLocale: async () => "en",
}));
jest.mock("../../services/default-plugins.service", () => ({
  enableDefaultPlugins: async () => undefined,
}));
const mockLimited = { value: false };
jest.mock("../../services/rate-limit.service", () => ({
  rateLimitService: {
    checkKeyRateLimit: async () => ({ limited: mockLimited.value }),
    checkIpRateLimit: async () => ({ limited: false }),
    checkEmailRateLimit: async () => ({ limited: false }),
    resetRateLimit: async () => undefined,
  },
}));
jest.mock("../../services/redis.service", () => ({
  redisService: { isConnected: () => false, getClient: () => null },
}));
jest.mock("../../config/env", () => {
  const actual = jest.requireActual("../../config/env") as { config: object };
  return { ...actual, config: { ...actual.config, internal: { apiSecret: "s3cret" } } };
});

import { AppDataSource } from "../../database/data-source";
import { User } from "../../entities/user.entity";
import { Organization } from "../../entities/organization.entity";
import { UserOrganization } from "../../entities/user-organization.entity";
import { Session } from "../../entities/session.entity";
import { AuthCode } from "../../entities/auth-code.entity";
import { AuthUser } from "../../lib/auth/AuthUser";
import { hashPassword } from "../../lib/auth/utils/hashing";
import { authRouter } from "../../routes/v1/auth";
import { organizationsRouter } from "../../routes/v1/organizations";
import { invitationsRouter } from "../../routes/v1/invitations";
import { internalRouter } from "../../routes/v1/internal";
import { INTERNAL_SECRET_HEADER } from "../../trpc/middleware/internal";
import type { Context } from "../../trpc/context";

const DOMAIN = "account-access.test";
const ORG_ID = "ac0e0000-0000-4000-8000-000000000001";
const PASSWORD = "CorrectHorse9!";

const publicCtx = (headers: Record<string, string> = {}): Context =>
  ({
    user: null,
    organizationId: null,
    req: { headers },
    res: {},
    ipAddress: "203.0.113.7",
    userAgent: "jest",
  }) as unknown as Context;

async function memberCtx(userId: string): Promise<Context> {
  const user = await AppDataSource.getRepository(User).findOneOrFail({ where: { id: userId } });
  const userOrganization = await AppDataSource.getRepository(UserOrganization).findOneOrFail({
    where: { userId, organizationId: ORG_ID },
    relations: ["organization"],
  });
  return {
    user: new AuthUser(user, "jwt", { organizationId: ORG_ID, userOrganization }),
    organizationId: ORG_ID,
    req: { headers: {} },
    res: {},
  } as unknown as Context;
}

async function createMember(local: string, role: "owner" | "admin" | "member"): Promise<User> {
  const users = AppDataSource.getRepository(User);
  const user = await users.save(
    users.create({
      email: `${local}@${DOMAIN}`,
      password: await hashPassword(PASSWORD, "argon2"),
      isActive: true,
      emailVerified: true,
      // Legacy column: must not grant anything without an organization membership.
      role: "owner",
    }),
  );
  const memberships = AppDataSource.getRepository(UserOrganization);
  await memberships.save(
    memberships.create({ userId: user.id, organizationId: ORG_ID, role, isActive: true }),
  );
  return user;
}

/** The token in the latest verification email (sent off the response path). */
async function lastVerificationToken(): Promise<string> {
  for (let i = 0; i < 50 && mockSendTemplateEmail.mock.calls.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const calls = mockSendTemplateEmail.mock.calls;
  const call = calls[calls.length - 1]?.[0] as { variables: { verificationUrl: string } };
  return new URL(call.variables.verificationUrl).searchParams.get("token")!;
}

async function cleanup() {
  const users = await AppDataSource.getRepository(User)
    .createQueryBuilder("u")
    .where("u.email LIKE :domain", { domain: `%@${DOMAIN}` })
    .getMany();
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await AppDataSource.getRepository(Session).delete({ userId: In(ids) });
    await AppDataSource.getRepository(AuthCode).delete({ userId: In(ids) });
    const orgIds = users.map((u) => u.organizationId).filter((id): id is string => !!id);
    await AppDataSource.getRepository(UserOrganization).delete({ userId: In(ids) });
    await AppDataSource.getRepository(User).delete({ id: In(ids) });
    if (orgIds.length) await AppDataSource.getRepository(Organization).delete({ id: In(orgIds) });
  }
  await AppDataSource.getRepository(Organization).delete({ id: ORG_ID });
}

describe("account access", () => {
  let owner: User;
  let admin: User;
  let member: User;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    await cleanup();
    const orgs = AppDataSource.getRepository(Organization);
    await orgs.save(orgs.create({ id: ORG_ID, name: "Access Org", slug: "account-access-org" }));
    owner = await createMember("owner", "owner");
    admin = await createMember("admin", "admin");
    member = await createMember("member", "member");
  });

  beforeEach(() => {
    mockSendTemplateEmail.mockClear();
    mockLimited.value = false;
    process.env.CONNECT_ALLOWED_REDIRECT_ORIGINS = "https://billing.example.com";
  });

  afterAll(async () => {
    await cleanup();
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  describe("platform-wide user administration", () => {
    it("is not exposed on the auth router", () => {
      const procedures = Object.keys(authRouter._def.procedures);
      expect(procedures).not.toContain("listUsers");
      expect(procedures).not.toContain("deactivateUser");
    });

    it("grants no scopes from the legacy user role without an organization membership", async () => {
      const user = await AppDataSource.getRepository(User).findOneOrFail({
        where: { id: owner.id },
      });
      const authUser = new AuthUser(user, "jwt");
      expect(authUser.hasScope("*", "*")).toBe(false);
      expect(authUser.getRole()).toBeUndefined();
    });
  });

  describe("signup", () => {
    it("creates the account, emails a verification link and issues no session", async () => {
      const email = `new-signup@${DOMAIN}`;
      const result = await authRouter.createCaller(publicCtx()).register({
        email,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        organizationName: "New Signup Org",
      });

      expect(result).toEqual({
        success: true,
        emailVerificationRequired: true,
        message: expect.any(String),
      });
      expect(result).not.toHaveProperty("accessToken");

      const user = await AppDataSource.getRepository(User).findOneOrFail({ where: { email } });
      expect(user.emailVerified).toBe(false);
      expect(await AppDataSource.getRepository(Session).count({ where: { userId: user.id } })).toBe(
        0,
      );

      // Sign-in is refused until the link is used; the link then verifies the account.
      await expect(
        authRouter.createCaller(publicCtx()).login({ email, password: PASSWORD }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await authRouter
        .createCaller(publicCtx())
        .verifyEmail({ token: await lastVerificationToken() });
      const login = await authRouter.createCaller(publicCtx()).login({ email, password: PASSWORD });
      expect(login.accessToken).toEqual(expect.any(String));
    });

    it("answers an existing email like a new one, without a session or org", async () => {
      const orgsBefore = await AppDataSource.getRepository(UserOrganization).count({
        where: { userId: owner.id },
      });
      const result = await authRouter.createCaller(publicCtx()).register({
        email: owner.email,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        organizationName: "Second Org",
      });

      expect(result).toEqual({
        success: true,
        emailVerificationRequired: true,
        message: expect.any(String),
      });
      expect(
        await AppDataSource.getRepository(Session).count({ where: { userId: owner.id } }),
      ).toBe(0);
      expect(
        await AppDataSource.getRepository(UserOrganization).count({ where: { userId: owner.id } }),
      ).toBe(orgsBefore);
      expect(mockSendTemplateEmail).not.toHaveBeenCalled();
    });

    it("is rate limited", async () => {
      mockLimited.value = true;
      await expect(
        authRouter.createCaller(publicCtx()).register({
          email: `limited@${DOMAIN}`,
          password: PASSWORD,
          confirmPassword: PASSWORD,
        }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });

    it("rejects passwords over 128 characters", async () => {
      const long = "a".repeat(129);
      await expect(
        authRouter.createCaller(publicCtx()).register({
          email: `long@${DOMAIN}`,
          password: long,
          confirmPassword: long,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("does not accept an email-change token as a signup verification", async () => {
      const token = crypto.randomBytes(32).toString("hex");
      await AppDataSource.getRepository(User).update(member.id, {
        pendingEmail: `changed@${DOMAIN}`,
        emailVerificationTokenHash: crypto.createHash("sha256").update(token).digest("hex"),
        emailVerificationExpiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        authRouter.createCaller(publicCtx()).verifyEmail({ token }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      await AppDataSource.getRepository(User).update(member.id, {
        pendingEmail: null,
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      });
    });
  });

  describe("operator provisioning", () => {
    const internalCaller = (secret = "s3cret") =>
      internalRouter.createCaller(publicCtx({ [INTERNAL_SECRET_HEADER]: secret }));

    it("requires the internal secret", async () => {
      await expect(
        internalCaller("wrong").users.register({
          email: `operator@${DOMAIN}`,
          password: PASSWORD,
          organizationName: "Operator Org",
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("creates the account with a session and hands out verification tokens", async () => {
      const result = await internalCaller().users.register({
        email: `operator@${DOMAIN}`,
        password: PASSWORD,
        organizationName: "Operator Org",
      });
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.user.activeOrganizationId).toEqual(expect.any(String));
      expect(result.user.emailVerified).toBe(false);

      const { token } = await internalCaller().users.createEmailVerificationToken({
        userId: result.user.id,
      });
      await authRouter.createCaller(publicCtx()).verifyEmail({ token: token! });
      const user = await AppDataSource.getRepository(User).findOneOrFail({
        where: { id: result.user.id },
      });
      expect(user.emailVerified).toBe(true);
    });

    it("can create an already verified account", async () => {
      const result = await internalCaller().users.register({
        email: `operator-verified@${DOMAIN}`,
        password: PASSWORD,
        organizationName: "Verified Org",
        emailVerified: true,
      });
      expect(result.user.emailVerified).toBe(true);
    });
  });

  describe("auth codes", () => {
    it("are only issued for allowlisted destinations", async () => {
      const caller = authRouter.createCaller(await memberCtx(member.id));
      await expect(
        caller.generateAuthCode({ redirectUri: "https://elsewhere.example.org/landing" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const { code } = await caller.generateAuthCode({
        redirectUri: "https://billing.example.com/portal?x=1",
      });
      expect(code).toEqual(expect.any(String));
    });

    it("can be exchanged only once, even concurrently", async () => {
      const caller = authRouter.createCaller(await memberCtx(member.id));
      const { code } = await caller.generateAuthCode({
        redirectUri: "https://billing.example.com/portal",
      });

      const results = await Promise.allSettled([
        authRouter.createCaller(publicCtx()).exchangeAuthCode({ code }),
        authRouter.createCaller(publicCtx()).exchangeAuthCode({ code }),
        authRouter.createCaller(publicCtx()).exchangeAuthCode({ code }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });

    it("are refused once expired", async () => {
      const caller = authRouter.createCaller(await memberCtx(member.id));
      const { code } = await caller.generateAuthCode({
        redirectUri: "https://billing.example.com/portal",
      });
      await AppDataSource.getRepository(AuthCode).update(
        { userId: member.id, used: false },
        { expiresAt: new Date(Date.now() - 1000) },
      );
      await expect(
        authRouter.createCaller(publicCtx()).exchangeAuthCode({ code }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("owner role", () => {
    it("an admin cannot make a member owner", async () => {
      const caller = organizationsRouter.createCaller(await memberCtx(admin.id));
      await expect(
        caller.updateMemberRole({ userId: member.id, role: "owner" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("an admin cannot demote or remove an owner", async () => {
      const caller = organizationsRouter.createCaller(await memberCtx(admin.id));
      await expect(
        caller.updateMemberRole({ userId: owner.id, role: "member" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.removeMember({ userId: owner.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("an admin cannot invite an owner", async () => {
      const caller = invitationsRouter.createCaller(await memberCtx(admin.id));
      await expect(
        caller.sendInvitation({ email: `invitee@${DOMAIN}`, role: "owner" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects malformed permissions", async () => {
      const caller = organizationsRouter.createCaller(await memberCtx(owner.id));
      await expect(
        caller.updateMemberRole({ userId: member.id, role: "member", permissions: ["everything"] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("an owner can make a member owner", async () => {
      const caller = organizationsRouter.createCaller(await memberCtx(owner.id));
      const result = await caller.updateMemberRole({ userId: member.id, role: "owner" });
      expect(result.data.role).toBe("owner");
    });
  });
});
