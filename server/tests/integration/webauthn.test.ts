/**
 * Security keys and passkeys as a second factor: registration, the second
 * login step, step-up, counter checks, removal rules, and organizations that
 * require two-factor authentication. Uses a software authenticator.
 */
import "reflect-metadata";
import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from "@jest/globals";
import { In } from "typeorm";

const mockRedis = {
  connected: true,
  values: new Map<string, string>(),
  ttls: new Map<string, number>(),
  client: {
    set: async (key: string, value: string, _mode: string, ttl: number) => {
      mockRedis.values.set(key, value);
      mockRedis.ttls.set(key, ttl);
      return "OK";
    },
    getdel: async (key: string) => {
      const value = mockRedis.values.get(key) ?? null;
      mockRedis.values.delete(key);
      return value;
    },
  },
};
jest.mock("../../services/redis.service", () => ({
  redisService: {
    isConnected: () => mockRedis.connected,
    getClient: () => mockRedis.client,
  },
}));
jest.mock("../../services/email.service", () => ({
  emailService: { initialize: async () => undefined, sendTemplateEmail: async () => ({}) },
  getOrganizationLocale: async () => "en",
}));
jest.mock("../../services/default-plugins.service", () => ({
  enableDefaultPlugins: async () => undefined,
}));
jest.mock("../../trpc/middleware/rate-limit", () => {
  const actual = jest.requireActual("../../trpc/middleware/rate-limit") as object;
  const { t } = jest.requireActual("../../trpc/init") as typeof import("../../trpc/init");
  return { ...actual, rateLimitMiddleware: () => t.middleware(({ next }) => next()) };
});
jest.mock("../../services/rate-limit.service", () => ({
  rateLimitService: {
    checkIpRateLimit: async () => ({ limited: false }),
    checkEmailRateLimit: async () => ({ limited: false }),
    checkKeyRateLimit: async () => ({ limited: false }),
    resetRateLimit: async () => undefined,
  },
}));

import { AppDataSource } from "../../database/data-source";
import { UserMfa } from "../../database/entities/user-mfa.entity";
import { UserWebauthnCredential } from "../../database/entities/user-webauthn-credential.entity";
import { User } from "../../entities/user.entity";
import { Organization } from "../../entities/organization.entity";
import { UserOrganization } from "../../entities/user-organization.entity";
import { Session } from "../../entities/session.entity";
import { AuthCode } from "../../entities/auth-code.entity";
import { AuditLog } from "../../entities/audit-log.entity";
import { AuthUser } from "../../lib/auth/AuthUser";
import { hashPassword } from "../../lib/auth/utils/hashing";
import { base32Decode, totpCode, totpStepAt } from "../../lib/auth/totp";
import { mfaService } from "../../services/mfa.service";
import { authRouter } from "../../routes/v1/auth";
import { organizationsRouter } from "../../routes/v1/organizations";
import type { Context } from "../../trpc/context";
import { SoftwareAuthenticator } from "../helpers/software-authenticator";
import { purgeAuditLogs } from "../helpers/audit-logs";

const DOMAIN = "webauthn.test";
const ORG_ID = "ac0e0000-0000-4000-8000-0000000000f2";
const PASSWORD = "CorrectHorse9!";
const SESSION_ID = "ac0e0000-0000-4000-8000-0000000000b1";
const RP_ID = "hay.test";
const ORIGIN = "https://app.hay.test";

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

const keyApi = async (userId: string, sessionId?: string) =>
  authRouter.createCaller(await jwtCtx(userId, sessionId)).mfa.webauthn;

/** Register a key as the person's first factor. */
async function enrolKey(user: User, authenticator: SoftwareAuthenticator, name = "Test key") {
  const api = await keyApi(user.id);
  const options = await api.registrationOptions({ password: PASSWORD });
  return api.verifyRegistration({ response: authenticator.create(options), name });
}

/** Confirm a key assertion for the session, so sensitive actions may proceed. */
async function stepUpWithKey(userId: string, authenticator: SoftwareAuthenticator) {
  const api = await keyApi(userId);
  const options = await api.stepUpOptions();
  await api.stepUp({ response: authenticator.get(options) });
}

async function setOrgMfaRequired(required: boolean) {
  await AppDataSource.getRepository(Organization).update(ORG_ID, {
    settings: { mfaRequired: required },
  });
}

const auditActions = async (userId: string) =>
  (await AppDataSource.getRepository(AuditLog).find({ where: { userId } })).map(
    (entry) => entry.action,
  );

async function cleanup() {
  const users = await AppDataSource.getRepository(User)
    .createQueryBuilder("u")
    .where("u.email LIKE :domain", { domain: `%@${DOMAIN}` })
    .getMany();
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await purgeAuditLogs("user_id = ANY($1)", [ids]);
    await AppDataSource.getRepository(Session).delete({ userId: In(ids) });
    await AppDataSource.getRepository(AuthCode).delete({ userId: In(ids) });
    await AppDataSource.getRepository(UserWebauthnCredential).delete({ userId: In(ids) });
    await AppDataSource.getRepository(UserMfa).delete({ userId: In(ids) });
    await AppDataSource.getRepository(UserOrganization).delete({ userId: In(ids) });
    await AppDataSource.getRepository(User).delete({ id: In(ids) });
  }
  await AppDataSource.getRepository(Organization).delete({ id: ORG_ID });
}

describe("security keys and passkeys", () => {
  let owner: User;
  let member: User;
  let authenticator: SoftwareAuthenticator;
  const env = { ...process.env };

  beforeAll(async () => {
    process.env.WEBAUTHN_RP_ID = RP_ID;
    process.env.WEBAUTHN_ORIGINS = ORIGIN;
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
  });

  beforeEach(async () => {
    mockRedis.connected = true;
    mockRedis.values.clear();
    mockRedis.ttls.clear();
    await cleanup();
    const orgs = AppDataSource.getRepository(Organization);
    await orgs.save(orgs.create({ id: ORG_ID, name: "Key Org", slug: "key-org" }));
    owner = await createMember("owner", "owner");
    member = await createMember("member", "member");
    authenticator = new SoftwareAuthenticator(ORIGIN, RP_ID);
  });

  afterAll(async () => {
    process.env = env;
    await cleanup();
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  const login = () =>
    authRouter.createCaller(publicCtx()).login({ email: owner.email, password: PASSWORD });

  describe("registration", () => {
    it("needs the password for the first factor", async () => {
      const api = await keyApi(owner.id);
      await expect(api.registrationOptions({ password: "wrong-password" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await expect(api.registrationOptions({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("keeps the challenge for five minutes and takes it back out when used", async () => {
      const api = await keyApi(owner.id);
      const options = await api.registrationOptions({ password: PASSWORD });
      const [key] = [...mockRedis.values.keys()];
      expect(mockRedis.values.get(key)).toBe(options.challenge);
      expect(mockRedis.ttls.get(key)).toBe(300);

      await api.verifyRegistration({ response: authenticator.create(options) });
      expect(mockRedis.values.size).toBe(0);
    });

    it("stores the key, issues recovery codes and ends other sessions", async () => {
      await login();
      const sessions = AppDataSource.getRepository(Session);
      expect(await sessions.count({ where: { userId: owner.id } })).toBeGreaterThan(0);

      const result = await enrolKey(owner, authenticator, "Desk key");
      expect(result.recoveryCodes).toHaveLength(10);
      expect(result.credential.name).toBe("Desk key");

      const stored = await AppDataSource.getRepository(UserWebauthnCredential).findOneOrFail({
        where: { userId: owner.id },
      });
      expect(stored.credentialId).toBe(authenticator.id);
      expect(stored.signCount).toBe(0);
      const mfa = await AppDataSource.getRepository(UserMfa).findOneOrFail({
        where: { userId: owner.id },
      });
      expect(mfa.secret).toBeNull();
      expect(mfa.recoveryCodes).toHaveLength(10);
      expect(mfa.recoveryCodes).not.toContain(result.recoveryCodes![0]);

      const active = await sessions.find({ where: { userId: owner.id } });
      expect(active.every((session) => session.revokedAt)).toBe(true);
      expect(await auditActions(owner.id)).toContain("webauthn.add");
      expect(await mfaService.status(owner.id)).toMatchObject({
        enabled: true,
        totpEnabled: false,
        webauthnCount: 1,
        recoveryCodesRemaining: 10,
      });
    });

    it("cannot answer one challenge twice", async () => {
      const api = await keyApi(owner.id);
      const options = await api.registrationOptions({ password: PASSWORD });
      const response = authenticator.create(options);
      await api.verifyRegistration({ response });
      await stepUpWithKey(owner.id, authenticator);
      await expect(api.verifyRegistration({ response })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("refuses a response from another origin", async () => {
      const api = await keyApi(owner.id);
      const options = await api.registrationOptions({ password: PASSWORD });
      await expect(
        api.verifyRegistration({
          response: authenticator.create(options, { origin: "https://evil.example" }),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await AppDataSource.getRepository(UserWebauthnCredential).count()).toBe(0);
    });

    it("is refused without Redis, for options and for verification", async () => {
      const api = await keyApi(owner.id);
      const options = await api.registrationOptions({ password: PASSWORD });
      const response = authenticator.create(options);

      mockRedis.connected = false;
      await expect(api.registrationOptions({ password: PASSWORD })).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
      await expect(api.verifyRegistration({ response })).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
    });

    it("is off when no domain is configured", async () => {
      delete process.env.WEBAUTHN_RP_ID;
      delete process.env.WEBAUTHN_ORIGINS;
      try {
        const api = await keyApi(owner.id);
        await expect(api.registrationOptions({ password: PASSWORD })).rejects.toMatchObject({
          code: "SERVICE_UNAVAILABLE",
        });
      } finally {
        process.env.WEBAUTHN_RP_ID = RP_ID;
        process.env.WEBAUTHN_ORIGINS = ORIGIN;
      }
    });

    it("needs a recent step-up to add another key, and refuses the same key twice", async () => {
      await enrolKey(owner, authenticator);
      const api = await keyApi(owner.id);
      await expect(api.registrationOptions({})).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: expect.objectContaining({ type: "MFA_STEP_UP_REQUIRED" }),
      });

      await stepUpWithKey(owner.id, authenticator);
      const second = new SoftwareAuthenticator(ORIGIN, RP_ID);
      const options = await api.registrationOptions({});
      const added = await api.verifyRegistration({ response: second.create(options) });
      expect(added.recoveryCodes).toBeNull();
      expect(await api.list()).toHaveLength(2);

      const again = await api.registrationOptions({});
      await expect(
        api.verifyRegistration({ response: second.create(again) }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("second login step", () => {
    const challenge = async () => {
      const result = await login();
      if (!result.mfaRequired) throw new Error("expected a challenge");
      return result;
    };

    it("offers the key and issues a session only after it is used", async () => {
      await enrolKey(owner, authenticator);
      const result = await challenge();
      expect(result).toMatchObject({ methods: { totp: false, webauthn: true } });
      expect(result).not.toHaveProperty("accessToken");

      const api = authRouter.createCaller(publicCtx()).mfa.webauthn;
      const options = await api.loginOptions({ challengeToken: result.challengeToken });
      expect(options.allowCredentials?.map((c) => c.id)).toEqual([authenticator.id]);
      const session = await api.verifyLogin({
        challengeToken: result.challengeToken,
        response: authenticator.get(options),
      });
      expect(session).toHaveProperty("accessToken");

      const stored = await AppDataSource.getRepository(UserWebauthnCredential).findOneOrFail({
        where: { userId: owner.id },
      });
      expect(stored.signCount).toBe(1);
      expect(stored.lastUsedAt).toBeTruthy();
    });

    it("cannot answer one challenge twice", async () => {
      await enrolKey(owner, authenticator);
      const { challengeToken } = await challenge();
      const api = authRouter.createCaller(publicCtx()).mfa.webauthn;
      const options = await api.loginOptions({ challengeToken });
      const response = authenticator.get(options);
      await api.verifyLogin({ challengeToken, response });
      await expect(api.verifyLogin({ challengeToken, response })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("refuses a key that belongs to someone else", async () => {
      await enrolKey(owner, authenticator);
      const other = new SoftwareAuthenticator(ORIGIN, RP_ID);
      await enrolKey(member, other);
      const { challengeToken } = await challenge();
      const api = authRouter.createCaller(publicCtx()).mfa.webauthn;
      const options = await api.loginOptions({ challengeToken });
      await expect(
        api.verifyLogin({ challengeToken, response: other.get(options) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await auditActions(owner.id)).toContain("webauthn.verify");
    });

    it("refuses a counter that did not advance, and records it", async () => {
      await enrolKey(owner, authenticator);
      const api = authRouter.createCaller(publicCtx()).mfa.webauthn;

      const first = await challenge();
      const options = await api.loginOptions({ challengeToken: first.challengeToken });
      await api.verifyLogin({
        challengeToken: first.challengeToken,
        response: authenticator.get(options, { counter: 5 }),
      });

      const second = await challenge();
      const again = await api.loginOptions({ challengeToken: second.challengeToken });
      await expect(
        api.verifyLogin({
          challengeToken: second.challengeToken,
          response: authenticator.get(again, { counter: 5 }),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await auditActions(owner.id)).toContain("webauthn.counter_regression");

      const stored = await AppDataSource.getRepository(UserWebauthnCredential).findOneOrFail({
        where: { userId: owner.id },
      });
      expect(stored.signCount).toBe(5);
    });

    it("accepts authenticators that never count", async () => {
      const flat = new SoftwareAuthenticator(ORIGIN, RP_ID, false);
      await enrolKey(owner, flat);
      const api = authRouter.createCaller(publicCtx()).mfa.webauthn;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { challengeToken } = await challenge();
        const options = await api.loginOptions({ challengeToken });
        await expect(
          api.verifyLogin({ challengeToken, response: flat.get(options) }),
        ).resolves.toHaveProperty("accessToken");
      }
    });

    it("is refused without Redis", async () => {
      await enrolKey(owner, authenticator);
      const { challengeToken } = await challenge();
      mockRedis.connected = false;
      await expect(
        authRouter.createCaller(publicCtx()).mfa.webauthn.loginOptions({ challengeToken }),
      ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    });

    it("still accepts recovery codes", async () => {
      const { recoveryCodes } = await enrolKey(owner, authenticator);
      const { challengeToken } = await challenge();
      const session = await authRouter
        .createCaller(publicCtx())
        .mfa.verifyLogin({ challengeToken, code: recoveryCodes![0] });
      expect(session).toHaveProperty("accessToken");
      expect(await mfaService.status(owner.id)).toMatchObject({ recoveryCodesRemaining: 9 });
    });

    it("lists the authenticator app next to the key when both are set up", async () => {
      await enrolKey(owner, authenticator);
      const caller = authRouter.createCaller(await jwtCtx(owner.id));
      await stepUpWithKey(owner.id, authenticator);
      const { secret } = await caller.mfa.beginEnrolment({ password: PASSWORD });
      await caller.mfa.confirmEnrolment({
        code: totpCode(base32Decode(secret), totpStepAt(Date.now())),
      });
      expect(await login()).toMatchObject({ methods: { totp: true, webauthn: true } });
    });
  });

  describe("step-up", () => {
    const changeRole = async () =>
      organizationsRouter
        .createCaller(await jwtCtx(owner.id))
        .updateMemberRole({ userId: member.id, role: "contributor" });

    it("asks for the key, then lets that session through", async () => {
      await enrolKey(owner, authenticator);
      await expect(changeRole()).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: expect.objectContaining({ type: "MFA_STEP_UP_REQUIRED" }),
      });
      await stepUpWithKey(owner.id, authenticator);
      await expect(changeRole()).resolves.toBeDefined();
    });

    it("keeps the step-up challenge to the session that asked", async () => {
      await enrolKey(owner, authenticator);
      const options = await (await keyApi(owner.id)).stepUpOptions();
      const otherSession = await keyApi(owner.id, "ac0e0000-0000-4000-8000-0000000000b2");
      await expect(
        otherSession.stepUp({ response: authenticator.get(options) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("needs a step-up to regenerate recovery codes without a code", async () => {
      await enrolKey(owner, authenticator);
      const caller = authRouter.createCaller(await jwtCtx(owner.id));
      await expect(caller.mfa.regenerateRecoveryCodes({})).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await stepUpWithKey(owner.id, authenticator);
      const { recoveryCodes } = await caller.mfa.regenerateRecoveryCodes({});
      expect(recoveryCodes).toHaveLength(10);
    });
  });

  describe("management", () => {
    it("lists and renames keys, for their owner only", async () => {
      const { credential } = await enrolKey(owner, authenticator, "Old name");
      const api = await keyApi(owner.id);
      await api.rename({ id: credential.id, name: "  New name " });
      expect((await api.list()).map((key) => key.name)).toEqual(["New name"]);

      const stranger = await keyApi(member.id);
      await expect(stranger.rename({ id: credential.id, name: "Mine" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(await stranger.list()).toEqual([]);
    });

    it("needs a step-up to remove a key, and audits the removal", async () => {
      const { credential } = await enrolKey(owner, authenticator);
      const second = new SoftwareAuthenticator(ORIGIN, RP_ID);
      await stepUpWithKey(owner.id, authenticator);
      const api = await keyApi(owner.id);
      await api.verifyRegistration({ response: second.create(await api.registrationOptions({})) });

      await AppDataSource.getRepository(UserMfa).update(
        { userId: owner.id },
        { stepUpExpiresAt: new Date(1000) },
      );
      await expect(api.remove({ id: credential.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: expect.objectContaining({ type: "MFA_STEP_UP_REQUIRED" }),
      });

      await stepUpWithKey(owner.id, authenticator);
      await api.remove({ id: credential.id });
      expect(await api.list()).toHaveLength(1);
      expect(await auditActions(owner.id)).toContain("webauthn.remove");
    });

    it("removing the last key turns two-factor off when the organization does not require it", async () => {
      const { credential } = await enrolKey(owner, authenticator);
      await stepUpWithKey(owner.id, authenticator);
      await (await keyApi(owner.id)).remove({ id: credential.id });
      expect(await mfaService.hasSecondFactor(owner.id)).toBe(false);
      expect(
        await AppDataSource.getRepository(UserMfa).count({ where: { userId: owner.id } }),
      ).toBe(0);
      expect((await login()).mfaRequired).toBe(false);
    });
  });

  describe("organizations requiring two-factor", () => {
    it("is satisfied by a key alone", async () => {
      await setOrgMfaRequired(true);
      const organizations = organizationsRouter.createCaller(await jwtCtx(owner.id));
      await expect(organizations.listMembers({})).rejects.toMatchObject({
        cause: expect.objectContaining({ type: "MFA_ENROLMENT_REQUIRED" }),
      });

      await enrolKey(owner, authenticator);
      await expect(organizations.listMembers({})).resolves.toBeDefined();
      expect(await mfaService.enrolmentRequired(owner.id)).toBe(false);
    });

    it("refuses to remove the last key", async () => {
      const { credential } = await enrolKey(owner, authenticator);
      await setOrgMfaRequired(true);
      await stepUpWithKey(owner.id, authenticator);
      await expect((await keyApi(owner.id)).remove({ id: credential.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: expect.objectContaining({ type: "MFA_FACTOR_REQUIRED" }),
      });
      expect(await mfaService.hasSecondFactor(owner.id)).toBe(true);
    });

    it("allows removing a key while an authenticator app remains, but not then the app", async () => {
      const { credential } = await enrolKey(owner, authenticator);
      await stepUpWithKey(owner.id, authenticator);
      const caller = authRouter.createCaller(await jwtCtx(owner.id));
      const { secret } = await caller.mfa.beginEnrolment({ password: PASSWORD });
      const step = totpStepAt(Date.now());
      await caller.mfa.confirmEnrolment({ code: totpCode(base32Decode(secret), step) });
      await setOrgMfaRequired(true);

      await stepUpWithKey(owner.id, authenticator);
      await (await keyApi(owner.id)).remove({ id: credential.id });
      expect(await mfaService.status(owner.id)).toMatchObject({
        totpEnabled: true,
        webauthnCount: 0,
      });

      await expect(
        caller.mfa.disable({ code: totpCode(base32Decode(secret), step + 1) }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: expect.objectContaining({ type: "MFA_FACTOR_REQUIRED" }),
      });
      expect(await mfaService.hasSecondFactor(owner.id)).toBe(true);
    });

    it("leaves one factor when the app and the only key are removed at once", async () => {
      const { credential } = await enrolKey(owner, authenticator);
      await stepUpWithKey(owner.id, authenticator);
      const caller = authRouter.createCaller(await jwtCtx(owner.id));
      const { secret } = await caller.mfa.beginEnrolment({ password: PASSWORD });
      const step = totpStepAt(Date.now());
      await caller.mfa.confirmEnrolment({ code: totpCode(base32Decode(secret), step) });
      await setOrgMfaRequired(true);
      await stepUpWithKey(owner.id, authenticator);
      const keys = await keyApi(owner.id);

      const results = await Promise.allSettled([
        caller.mfa.disable({ code: totpCode(base32Decode(secret), step + 1) }),
        keys.remove({ id: credential.id }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await mfaService.hasSecondFactor(owner.id)).toBe(true);
    });

    it("turning the app off leaves the keys working", async () => {
      await enrolKey(owner, authenticator);
      await stepUpWithKey(owner.id, authenticator);
      const caller = authRouter.createCaller(await jwtCtx(owner.id));
      const { secret } = await caller.mfa.beginEnrolment({ password: PASSWORD });
      const step = totpStepAt(Date.now());
      await caller.mfa.confirmEnrolment({ code: totpCode(base32Decode(secret), step) });

      await caller.mfa.disable({ code: totpCode(base32Decode(secret), step + 1) });
      expect(await mfaService.status(owner.id)).toMatchObject({
        enabled: true,
        totpEnabled: false,
        webauthnCount: 1,
      });
      expect(await login()).toMatchObject({ methods: { totp: false, webauthn: true } });
    });
  });

  describe("adding an authenticator app", () => {
    it("needs a step-up when a security key is already active", async () => {
      await enrolKey(owner, authenticator);
      const caller = authRouter.createCaller(await jwtCtx(owner.id));
      await expect(caller.mfa.beginEnrolment({ password: PASSWORD })).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: expect.objectContaining({ type: "MFA_STEP_UP_REQUIRED" }),
      });

      await stepUpWithKey(owner.id, authenticator);
      await expect(caller.mfa.beginEnrolment({ password: PASSWORD })).resolves.toHaveProperty(
        "secret",
      );
    });

    it("needs only the password as the first factor", async () => {
      const caller = authRouter.createCaller(await jwtCtx(owner.id));
      await expect(caller.mfa.beginEnrolment({ password: PASSWORD })).resolves.toHaveProperty(
        "secret",
      );
    });
  });

  describe("before the security key migration has run", () => {
    const table = "user_webauthn_credentials";
    const hidden = "user_webauthn_credentials_hidden";

    it("still asks for the authenticator app at sign-in", async () => {
      const caller = authRouter.createCaller(await jwtCtx(owner.id));
      const { secret } = await caller.mfa.beginEnrolment({ password: PASSWORD });
      await caller.mfa.confirmEnrolment({
        code: totpCode(base32Decode(secret), totpStepAt(Date.now())),
      });

      await AppDataSource.query(`ALTER TABLE "${table}" RENAME TO "${hidden}"`);
      try {
        expect(await mfaService.factors(owner.id)).toMatchObject({ totp: true, webauthn: 0 });
        expect(await login()).toMatchObject({ methods: { totp: true, webauthn: false } });
      } finally {
        await AppDataSource.query(`ALTER TABLE "${hidden}" RENAME TO "${table}"`);
      }
    });
  });
});
