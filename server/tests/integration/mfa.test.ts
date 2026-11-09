/**
 * Two-factor sign-in: enrolment, the second login step, single-use codes,
 * step-up on sensitive actions, and organizations that require it.
 */
import "reflect-metadata";
import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";
import { In } from "typeorm";

const mockLimiter = { limited: false, unavailable: false };
jest.mock("../../services/email.service", () => ({
  emailService: { initialize: async () => undefined, sendTemplateEmail: async () => ({}) },
  getOrganizationLocale: async () => "en",
}));
jest.mock("../../services/default-plugins.service", () => ({
  enableDefaultPlugins: async () => undefined,
}));
jest.mock("../../services/redis.service", () => ({
  redisService: { isConnected: () => false, getClient: () => null },
}));
jest.mock("../../trpc/middleware/rate-limit", () => {
  const actual = jest.requireActual("../../trpc/middleware/rate-limit") as object;
  const { t } = jest.requireActual("../../trpc/init") as typeof import("../../trpc/init");
  return { ...actual, rateLimitMiddleware: () => t.middleware(({ next }) => next()) };
});
jest.mock("../../services/rate-limit.service", () => {
  const { TRPCError } = jest.requireActual("@trpc/server") as typeof import("@trpc/server");
  const check = async (_id: string, _max: number, _window: number, o: { scope: string }) => {
    if (o.scope === "mfa-verify") {
      if (mockLimiter.unavailable) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "unavailable" });
      }
      return { limited: mockLimiter.limited };
    }
    return { limited: false };
  };
  return {
    rateLimitService: {
      checkIpRateLimit: check,
      checkEmailRateLimit: check,
      checkKeyRateLimit: async () => ({ limited: false }),
      resetRateLimit: async () => undefined,
    },
  };
});

import { AppDataSource } from "../../database/data-source";
import { UserMfa } from "../../database/entities/user-mfa.entity";
import { User } from "../../entities/user.entity";
import { Organization } from "../../entities/organization.entity";
import { UserOrganization } from "../../entities/user-organization.entity";
import { Session } from "../../entities/session.entity";
import { AuthCode } from "../../entities/auth-code.entity";
import { AuthUser } from "../../lib/auth/AuthUser";
import { base32Decode, totpCode, totpStepAt } from "../../lib/auth/totp";
import { hashPassword } from "../../lib/auth/utils/hashing";
import { verifyToken } from "../../lib/auth/utils/jwt";
import { withMfaStepUp } from "../../middleware/auth";
import { mfaService } from "../../services/mfa.service";
import { authRouter } from "../../routes/v1/auth";
import { organizationsRouter } from "../../routes/v1/organizations";
import type { Context } from "../../trpc/context";

const DOMAIN = "mfa.test";
const ORG_ID = "ac0e0000-0000-4000-8000-0000000000f1";
const PASSWORD = "CorrectHorse9!";
const SESSION_ID = "ac0e0000-0000-4000-8000-0000000000a1";

let clock = Date.now();
/** A code from the next time step, so each use is fresh. */
function nextCode(secret: string): string {
  clock += 30_000;
  return totpCode(base32Decode(secret), totpStepAt(clock));
}

const publicCtx = (): Context =>
  ({
    user: null,
    organizationId: null,
    req: { headers: {} },
    res: {},
    ipAddress: "203.0.113.9",
    userAgent: "jest",
  }) as unknown as Context;

async function jwtCtx(userId: string, sessionId = SESSION_ID): Promise<Context> {
  const user = await AppDataSource.getRepository(User).findOneOrFail({ where: { id: userId } });
  const userOrganization = await AppDataSource.getRepository(UserOrganization).findOneOrFail({
    where: { userId, organizationId: ORG_ID },
    relations: ["organization"],
  });
  return {
    user: new AuthUser(user, "jwt", { sessionId, organizationId: ORG_ID, userOrganization }),
    organizationId: ORG_ID,
    req: { headers: {} },
    res: {},
    ipAddress: "203.0.113.9",
    userAgent: "jest",
  } as unknown as Context;
}

async function createMember(local: string, role: "owner" | "member"): Promise<User> {
  const users = AppDataSource.getRepository(User);
  const user = await users.save(
    users.create({
      email: `${local}@${DOMAIN}`,
      password: await hashPassword(PASSWORD),
      isActive: true,
      emailVerified: true,
    }),
  );
  const memberships = AppDataSource.getRepository(UserOrganization);
  await memberships.save(
    memberships.create({ userId: user.id, organizationId: ORG_ID, role, isActive: true }),
  );
  return user;
}

/** Enrol the user, leaving the clock on the step that was just used. */
async function enrol(user: User): Promise<{ secret: string; recoveryCodes: string[] }> {
  const caller = authRouter.createCaller(await jwtCtx(user.id));
  const { secret } = await caller.mfa.beginEnrolment({ password: PASSWORD });
  const { recoveryCodes } = await caller.mfa.confirmEnrolment({ code: nextCode(secret) });
  return { secret, recoveryCodes };
}

async function setOrgMfaRequired(required: boolean) {
  await AppDataSource.getRepository(Organization).update(ORG_ID, {
    settings: { mfaRequired: required },
  });
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
    await AppDataSource.getRepository(UserMfa).delete({ userId: In(ids) });
    await AppDataSource.getRepository(UserOrganization).delete({ userId: In(ids) });
    await AppDataSource.getRepository(User).delete({ id: In(ids) });
  }
  await AppDataSource.getRepository(Organization).delete({ id: ORG_ID });
}

describe("two-factor authentication", () => {
  let owner: User;
  let member: User;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    jest.spyOn(Date, "now").mockImplementation(() => clock);
  });

  beforeEach(async () => {
    mockLimiter.limited = false;
    mockLimiter.unavailable = false;
    await cleanup();
    const orgs = AppDataSource.getRepository(Organization);
    await orgs.save(orgs.create({ id: ORG_ID, name: "MFA Org", slug: "mfa-org" }));
    owner = await createMember("owner", "owner");
    member = await createMember("member", "member");
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await cleanup();
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  const login = () =>
    authRouter.createCaller(publicCtx()).login({ email: owner.email, password: PASSWORD });

  it("leaves sign-in unchanged for people without two-factor", async () => {
    const result = await login();
    expect(result.mfaRequired).toBe(false);
    expect(result).toHaveProperty("accessToken");
  });

  describe("enrolment", () => {
    it("needs the password", async () => {
      const caller = authRouter.createCaller(await jwtCtx(owner.id));
      await expect(caller.mfa.beginEnrolment({ password: "wrong-password" })).rejects.toMatchObject(
        { code: "BAD_REQUEST" },
      );
    });

    it("stores the secret encrypted and only hashes of the recovery codes", async () => {
      const { secret, recoveryCodes } = await enrol(owner);
      expect(recoveryCodes).toHaveLength(10);
      const row = await AppDataSource.getRepository(UserMfa).findOneOrFail({
        where: { userId: owner.id },
      });
      expect(row.secret.startsWith("enc:v3:")).toBe(true);
      expect(row.secret).not.toContain(secret);
      expect(row.recoveryCodes).toHaveLength(10);
      expect(row.recoveryCodes).not.toContain(recoveryCodes[0]);
    });

    it("does not activate on a wrong code, and cannot restart once active", async () => {
      const caller = authRouter.createCaller(await jwtCtx(owner.id));
      const { secret } = await caller.mfa.beginEnrolment({ password: PASSWORD });
      await expect(caller.mfa.confirmEnrolment({ code: "000000" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect((await caller.mfa.status()).enabled).toBe(false);

      await caller.mfa.confirmEnrolment({ code: nextCode(secret) });
      await expect(caller.mfa.beginEnrolment({ password: PASSWORD })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("ends the account's other sessions", async () => {
      const first = await login();
      expect(first.mfaRequired).toBe(false);
      const sessions = AppDataSource.getRepository(Session);
      const before = await sessions.count({ where: { userId: owner.id } });
      expect(before).toBeGreaterThan(0);

      await enrol(owner);
      const active = await sessions.find({ where: { userId: owner.id } });
      expect(active.every((session) => session.revokedAt)).toBe(true);
    });
  });

  describe("second login step", () => {
    it("issues no session until a code is given", async () => {
      const { secret } = await enrol(owner);
      const challenge = await login();
      expect(challenge).toEqual({
        mfaRequired: true,
        challengeToken: expect.any(String),
        expiresIn: 300,
      });
      expect(challenge).not.toHaveProperty("accessToken");
      if (!challenge.mfaRequired) throw new Error("expected a challenge");

      const caller = authRouter.createCaller(publicCtx());
      await expect(
        caller.mfa.verifyLogin({ challengeToken: challenge.challengeToken, code: "000000" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      const result = await caller.mfa.verifyLogin({
        challengeToken: challenge.challengeToken,
        code: nextCode(secret),
      });
      expect(result).toHaveProperty("accessToken");
    });

    it("does not accept the challenge as an access token", async () => {
      await enrol(owner);
      const challenge = await login();
      if (!challenge.mfaRequired) throw new Error("expected a challenge");
      expect(() => verifyToken(challenge.challengeToken)).toThrow();
    });

    it("refuses a challenge after the password changed", async () => {
      const { secret } = await enrol(owner);
      const challenge = await login();
      if (!challenge.mfaRequired) throw new Error("expected a challenge");
      await AppDataSource.getRepository(User).increment({ id: owner.id }, "tokenVersion", 1);
      await expect(
        authRouter.createCaller(publicCtx()).mfa.verifyLogin({
          challengeToken: challenge.challengeToken,
          code: nextCode(secret),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("refuses the same code twice", async () => {
      const { secret } = await enrol(owner);
      const challenge = await login();
      if (!challenge.mfaRequired) throw new Error("expected a challenge");
      const code = nextCode(secret);
      const caller = authRouter.createCaller(publicCtx());
      const verify = () =>
        caller.mfa.verifyLogin({ challengeToken: challenge.challengeToken, code });
      await verify();
      await expect(verify()).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("accepts each recovery code once, however it is typed", async () => {
      const { recoveryCodes } = await enrol(owner);
      const challenge = await login();
      if (!challenge.mfaRequired) throw new Error("expected a challenge");
      const caller = authRouter.createCaller(publicCtx());
      const typed = recoveryCodes[0].replace(/-/g, "").toLowerCase();
      const verify = () =>
        caller.mfa.verifyLogin({ challengeToken: challenge.challengeToken, code: typed });

      await verify();
      await expect(verify()).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const status = await authRouter.createCaller(await jwtCtx(owner.id)).mfa.status();
      expect(status.recoveryCodesRemaining).toBe(9);
    });

    it("refuses attempts over the limit even with the right code", async () => {
      const { secret } = await enrol(owner);
      const challenge = await login();
      if (!challenge.mfaRequired) throw new Error("expected a challenge");
      mockLimiter.limited = true;
      await expect(
        authRouter.createCaller(publicCtx()).mfa.verifyLogin({
          challengeToken: challenge.challengeToken,
          code: nextCode(secret),
        }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });

    it("refuses when the limiter is unavailable", async () => {
      const { secret } = await enrol(owner);
      const challenge = await login();
      if (!challenge.mfaRequired) throw new Error("expected a challenge");
      mockLimiter.unavailable = true;
      await expect(
        authRouter.createCaller(publicCtx()).mfa.verifyLogin({
          challengeToken: challenge.challengeToken,
          code: nextCode(secret),
        }),
      ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    });
  });

  describe("step-up", () => {
    const changeRole = async (sessionId?: string) =>
      organizationsRouter
        .createCaller(await jwtCtx(owner.id, sessionId))
        .updateMemberRole({ userId: member.id, role: "contributor" });

    it("does not get in the way of people without two-factor", async () => {
      await expect(changeRole()).resolves.toBeDefined();
    });

    it("asks enrolled people for a code, then lets that session through", async () => {
      const { secret } = await enrol(owner);
      await expect(changeRole()).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: expect.objectContaining({ type: "MFA_STEP_UP_REQUIRED" }),
      });

      await authRouter.createCaller(await jwtCtx(owner.id)).mfa.stepUp({ code: nextCode(secret) });
      await expect(changeRole()).resolves.toBeDefined();
    });

    it("applies to the session that confirmed the code only", async () => {
      const { secret } = await enrol(owner);
      await authRouter.createCaller(await jwtCtx(owner.id)).mfa.stepUp({ code: nextCode(secret) });
      await expect(changeRole("ac0e0000-0000-4000-8000-0000000000a2")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("expires", async () => {
      const { secret } = await enrol(owner);
      await authRouter.createCaller(await jwtCtx(owner.id)).mfa.stepUp({ code: nextCode(secret) });
      await AppDataSource.getRepository(UserMfa).update(
        { userId: owner.id },
        { stepUpExpiresAt: new Date(1000) },
      );
      await expect(changeRole()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("does not apply to API tokens", async () => {
      await enrol(owner);
      const user = await AppDataSource.getRepository(User).findOneOrFail({
        where: { id: owner.id },
      });
      await expect(
        mfaService.assertStepUp(new AuthUser(user, "apikey", { apiKeyId: "key" })),
      ).resolves.toBeUndefined();
    });

    it("guards plugin uploads, answering with the type the dashboard reacts to", async () => {
      await enrol(owner);
      const { user } = (await jwtCtx(owner.id)) as unknown as { user: AuthUser };
      const json = jest.fn();
      const status = jest.fn((_code: number) => ({ json }));
      const next = jest.fn();
      await withMfaStepUp(
        { user } as unknown as Request,
        { status } as unknown as Response,
        next as unknown as NextFunction,
      );
      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ type: "MFA_STEP_UP_REQUIRED" }));
    });

    it("leaves auth codes for external apps working", async () => {
      process.env.CONNECT_ALLOWED_REDIRECT_ORIGINS = "https://billing.example.com";
      await enrol(owner);
      const { code } = await authRouter
        .createCaller(await jwtCtx(owner.id))
        .generateAuthCode({ redirectUri: "https://billing.example.com/portal" });
      const result = await authRouter.createCaller(publicCtx()).exchangeAuthCode({ code });
      expect(result).toHaveProperty("accessToken");
    });

    it("needs the code to turn two-factor off", async () => {
      const { secret } = await enrol(owner);
      const caller = authRouter.createCaller(await jwtCtx(owner.id));
      await expect(caller.mfa.disable({ code: "000000" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await caller.mfa.disable({ code: nextCode(secret) });
      expect((await caller.mfa.status()).enabled).toBe(false);
    });
  });

  describe("organizations requiring two-factor", () => {
    it("lets the owner sign in and sends them to enrol", async () => {
      await setOrgMfaRequired(true);
      const result = await login();
      expect(result.mfaRequired).toBe(false);
      if (result.mfaRequired) throw new Error("expected a session");
      expect(result.mfaEnrolmentRequired).toBe(true);
      expect(result).toHaveProperty("accessToken");
    });

    it("holds organization data back until enrolment, but not enrolment itself", async () => {
      await setOrgMfaRequired(true);
      const organizations = organizationsRouter.createCaller(await jwtCtx(owner.id));
      await expect(organizations.listMembers({})).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: expect.objectContaining({ type: "MFA_ENROLMENT_REQUIRED" }),
      });

      await enrol(owner);
      await expect(organizations.listMembers({})).resolves.toBeDefined();
      const refreshed = await login();
      expect(refreshed.mfaRequired).toBe(true);
    });

    it("can be turned on with nobody enrolled, and only the owner lifts it", async () => {
      const ownerOrg = organizationsRouter.createCaller(await jwtCtx(owner.id));
      await ownerOrg.setMfaRequired({ required: true });
      expect((await login()).mfaRequired).toBe(false);

      await setOrgMfaRequired(false);
      const memberships = AppDataSource.getRepository(UserOrganization);
      await memberships.update({ userId: member.id }, { role: "admin" });
      await expect(
        organizationsRouter
          .createCaller(await jwtCtx(member.id))
          .setMfaRequired({ required: false }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
