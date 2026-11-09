/**
 * Per-organization OpenID Connect sign-in: the happy path, each way a sign-in is
 * refused, role mapping, and enforcement. A provider runs on a loopback port.
 */
process.env.SSO_ALLOW_PRIVATE_PROVIDER_HOSTS = "true";

import "reflect-metadata";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  jest,
} from "@jest/globals";
import dns from "dns/promises";
import { In } from "typeorm";

const mockRedis = {
  values: new Map<string, string>(),
  client: {
    set: async (key: string, value: string) => {
      mockRedis.values.set(key, value);
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
  redisService: { isConnected: () => true, getClient: () => mockRedis.client },
}));
jest.mock("../../services/email.service", () => ({
  emailService: { initialize: async () => undefined, sendTemplateEmail: async () => ({}) },
  getOrganizationLocale: async () => "en",
}));
jest.mock("../../services/default-plugins.service", () => ({
  enableDefaultPlugins: async () => undefined,
}));

import { AppDataSource } from "../../database/data-source";
import { SsoConnection } from "../../database/entities/sso-connection.entity";
import { SsoDomain } from "../../database/entities/sso-domain.entity";
import { SsoIdentity } from "../../database/entities/sso-identity.entity";
import { UserMfa } from "../../database/entities/user-mfa.entity";
import { AuditLog } from "../../entities/audit-log.entity";
import { Organization } from "../../entities/organization.entity";
import { Session } from "../../entities/session.entity";
import { User } from "../../entities/user.entity";
import { UserOrganization } from "../../entities/user-organization.entity";
import { AuthUser } from "../../lib/auth/AuthUser";
import { assertSsoPolicy } from "../../lib/auth/sso/policy";
import { hashPassword } from "../../lib/auth/utils/hashing";
import { verifyToken } from "../../lib/auth/utils/jwt";
import { authRouter } from "../../routes/v1/auth";
import { ssoRouter } from "../../routes/v1/sso";
import { mfaService } from "../../services/mfa.service";
import { SsoLoginError, ssoService } from "../../services/sso.service";
import type { Context } from "../../trpc/context";
import { FakeOidcProvider, type FakeLoginOverrides } from "../helpers/fake-oidc-provider";

const DOMAIN = "acme-sso.test";
const OTHER_DOMAIN = "other-sso.test";
const ORG_ID = "5500e000-0000-4000-8000-0000000000a1";
const OTHER_ORG_ID = "5500e000-0000-4000-8000-0000000000b2";
const PASSWORD = "CorrectHorse9!";

const idp = new FakeOidcProvider();
const actor = { userId: "", ipAddress: "203.0.113.9", userAgent: "jest" };

const publicCtx = (): Context =>
  ({
    user: null,
    organizationId: null,
    req: { headers: {} },
    res: {},
    ipAddress: "203.0.113.9",
    userAgent: "jest",
  }) as unknown as Context;

async function ownerCtx(user: User, organizationId = ORG_ID): Promise<Context> {
  const userOrganization = await AppDataSource.getRepository(UserOrganization).findOneOrFail({
    where: { userId: user.id, organizationId },
    relations: ["organization"],
  });
  return {
    user: new AuthUser(user, "jwt", { sessionId: "s", organizationId, userOrganization }),
    organizationId,
    req: { headers: {} },
    res: {},
    ipAddress: "203.0.113.9",
    userAgent: "jest",
  } as unknown as Context;
}

async function createUser(
  email: string,
  organizationId: string | null,
  role: "owner" | "member" = "member",
  emailVerified = true,
): Promise<User> {
  const users = AppDataSource.getRepository(User);
  const user = await users.save(
    users.create({ email, password: await hashPassword(PASSWORD), isActive: true, emailVerified }),
  );
  if (organizationId) {
    const memberships = AppDataSource.getRepository(UserOrganization);
    await memberships.save(
      memberships.create({ userId: user.id, organizationId, role, isActive: true }),
    );
  }
  return user;
}

function mockTxt(records: Record<string, string[][]>) {
  return jest.spyOn(dns, "resolveTxt").mockImplementation((async (name: string) => {
    if (!records[name]) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return records[name];
  }) as unknown as typeof dns.resolveTxt);
}

/** Adds the domain and proves it with a TXT record, as an owner would. */
async function verifiedDomain(organizationId: string, domain: string): Promise<SsoDomain> {
  const row = await ssoService.addDomain(organizationId, domain, actor);
  const spy = mockTxt({
    [`_hay-sso-challenge.${domain}`]: [[`hay-sso-verification=${row.verificationToken}`]],
  });
  const verified = await ssoService.verifyDomain(organizationId, row.id, actor);
  spy.mockRestore();
  return verified;
}

async function configure(overrides: Partial<Parameters<typeof ssoService.saveConnection>[1]> = {}) {
  await ssoService.saveConnection(
    ORG_ID,
    {
      issuer: idp.issuer,
      clientId: idp.clientId,
      clientSecret: idp.clientSecret,
      defaultRole: "member",
      roleClaim: null,
      roleMapping: {},
      enabled: true,
      ...overrides,
    },
    actor,
  );
}

/** A whole sign-in up to the one-minute ticket. */
async function signIn(email: string, overrides: FakeLoginOverrides = {}, binding?: string) {
  const { url, binding: issued } = await ssoService.beginLogin(email);
  const { code, state } = idp.login(url, overrides);
  return ssoService.handleCallback({ code, state, binding: binding ?? issued });
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SsoLoginError) return error.code;
    throw error;
  }
  throw new Error("expected the sign-in to be refused");
}

async function cleanup() {
  const users = AppDataSource.getRepository(User);
  const rows = await users
    .createQueryBuilder("u")
    .where("u.email LIKE :a OR u.email LIKE :b", { a: `%@${DOMAIN}`, b: `%@${OTHER_DOMAIN}` })
    .getMany();
  const ids = rows.map((u) => u.id);
  if (ids.length) {
    await AppDataSource.getRepository(Session).delete({ userId: In(ids) });
    await AppDataSource.getRepository(UserMfa).delete({ userId: In(ids) });
    await AppDataSource.getRepository(UserOrganization).delete({ userId: In(ids) });
    await users.delete({ id: In(ids) });
  }
  await AppDataSource.getRepository(Organization).delete({ id: In([ORG_ID, OTHER_ORG_ID]) });
}

describe("single sign-on (OpenID Connect)", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    await idp.start();
  });

  beforeEach(async () => {
    mockRedis.values.clear();
    idp.discoveryIssuer = idp.issuer;
    await cleanup();
    const orgs = AppDataSource.getRepository(Organization);
    await orgs.save(orgs.create({ id: ORG_ID, name: "Acme", slug: "acme-sso" }));
    await orgs.save(orgs.create({ id: OTHER_ORG_ID, name: "Other", slug: "other-sso" }));
    actor.userId = (await createUser(`admin@${OTHER_DOMAIN}`, OTHER_ORG_ID, "owner")).id;
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await cleanup();
    await idp.stop();
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  describe("a sign-in", () => {
    beforeEach(async () => {
      await verifiedDomain(ORG_ID, DOMAIN);
      await configure();
    });

    it("signs a new person in, provisions them with the default role and scopes the session", async () => {
      const ticket = await signIn(`new@${DOMAIN}`, {
        claims: { email: `new@${DOMAIN}`, sub: "s-new" },
      });
      const result = await authRouter.createCaller(publicCtx()).sso.exchange({ ticket });

      expect(result.mfaRequired).toBe(false);
      if (result.mfaRequired) throw new Error("unexpected challenge");
      expect(verifyToken<{ sso?: string }>(result.accessToken).sso).toBe(ORG_ID);

      const user = await AppDataSource.getRepository(User).findOneOrFail({
        where: { email: `new@${DOMAIN}` },
      });
      const membership = await AppDataSource.getRepository(UserOrganization).findOneOrFail({
        where: { userId: user.id, organizationId: ORG_ID },
      });
      expect(membership.role).toBe("member");
      expect(user.emailVerified).toBe(true);
      const session = await AppDataSource.getRepository(Session).findOneOrFail({
        where: { userId: user.id },
      });
      expect(session.metadata).toEqual({ ssoOrganizationId: ORG_ID });
      const connection = await AppDataSource.getRepository(SsoConnection).findOneOrFail({
        where: { organizationId: ORG_ID },
      });
      expect(connection.lastLoginAt).not.toBeNull();
      const audit = await AppDataSource.getRepository(AuditLog).findOne({
        where: { userId: user.id, action: "sso.login" },
      });
      expect(audit?.organizationId).toBe(ORG_ID);
    });

    it("sends PKCE, state and a nonce to the provider", async () => {
      const { url } = await ssoService.beginLogin(`someone@${DOMAIN}`);
      const params = new URL(url).searchParams;
      expect(params.get("code_challenge_method")).toBe("S256");
      expect(params.get("response_type")).toBe("code");
      expect(params.get("state")?.length).toBeGreaterThan(30);
      expect(params.get("nonce")?.length).toBeGreaterThan(30);
      expect(params.get("scope")).toBe("openid email profile");
    });

    it("matches a returning person by subject, not by email", async () => {
      await signIn(`first@${DOMAIN}`, { claims: { email: `first@${DOMAIN}`, sub: "stable" } });
      const ticket = await signIn(`first@${DOMAIN}`, {
        claims: { email: `renamed@${DOMAIN}`, sub: "stable" },
      });
      const { user } = await ssoService.redeemTicket(ticket);
      expect(user.email).toBe(`first@${DOMAIN}`);
      expect(
        await AppDataSource.getRepository(User).count({ where: { email: `renamed@${DOMAIN}` } }),
      ).toBe(0);
    });

    it("spends a ticket once", async () => {
      const ticket = await signIn(`once@${DOMAIN}`, {
        claims: { email: `once@${DOMAIN}`, sub: "s-once" },
      });
      await authRouter.createCaller(publicCtx()).sso.exchange({ ticket });
      await expect(
        authRouter.createCaller(publicCtx()).sso.exchange({ ticket }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("asks a person with a second factor for it when SSO is not enforced", async () => {
      const member = await createUser(`mfa@${DOMAIN}`, ORG_ID);
      await AppDataSource.getRepository(UserMfa).save(
        AppDataSource.getRepository(UserMfa).create({
          userId: member.id,
          secret: "enc:v3:placeholder",
          confirmedAt: new Date(),
          recoveryCodes: [],
        }),
      );
      const ticket = await signIn(`mfa@${DOMAIN}`, {
        claims: { email: `mfa@${DOMAIN}`, sub: "s-mfa" },
      });
      const result = await authRouter.createCaller(publicCtx()).sso.exchange({ ticket });
      expect(result.mfaRequired).toBe(true);
    });
  });

  describe("refusals", () => {
    beforeEach(async () => {
      await verifiedDomain(ORG_ID, DOMAIN);
      await configure();
    });

    const claims = (email = `person@${DOMAIN}`) => ({ claims: { email, sub: `sub-${email}` } });

    async function expectNoAccount(email: string) {
      expect(await AppDataSource.getRepository(User).count({ where: { email } })).toBe(0);
    }

    it("refuses a token from a different issuer", async () => {
      expect(
        await failureOf(
          signIn(`person@${DOMAIN}`, { ...claims(), issuer: "https://evil.example" }),
        ),
      ).toBe("token_invalid");
      await expectNoAccount(`person@${DOMAIN}`);
    });

    it("refuses a provider whose discovery document names another issuer", async () => {
      idp.discoveryIssuer = "https://evil.example";
      await expect(configure()).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await failureOf(signIn(`person@${DOMAIN}`, claims()))).toBe("provider_error");
    });

    it("refuses a token meant for another client", async () => {
      expect(
        await failureOf(signIn(`person@${DOMAIN}`, { ...claims(), audience: "someone-else" })),
      ).toBe("token_invalid");
    });

    it("refuses a token signed with a key the provider does not publish", async () => {
      expect(
        await failureOf(signIn(`person@${DOMAIN}`, { ...claims(), signWithOtherKey: true })),
      ).toBe("token_invalid");
    });

    it("refuses an expired token", async () => {
      expect(await failureOf(signIn(`person@${DOMAIN}`, { ...claims(), expiresIn: -600 }))).toBe(
        "token_invalid",
      );
    });

    it("refuses a token whose nonce is not this sign-in's", async () => {
      expect(
        await failureOf(signIn(`person@${DOMAIN}`, { ...claims(), nonce: "replayed-nonce" })),
      ).toBe("token_invalid");
      await expectNoAccount(`person@${DOMAIN}`);
    });

    it("refuses a state that was never issued", async () => {
      expect(
        await failureOf(ssoService.handleCallback({ code: "x", state: "made-up", binding: "y" })),
      ).toBe("state_invalid");
    });

    it("refuses a replayed state, and spends it even when the first attempt fails", async () => {
      const { url, binding } = await ssoService.beginLogin(`person@${DOMAIN}`);
      const { code, state } = idp.login(url, claims());
      await ssoService.handleCallback({ code, state, binding });
      const second = idp.login(url, claims());
      expect(
        await failureOf(ssoService.handleCallback({ code: second.code, state, binding })),
      ).toBe("state_invalid");

      const again = await ssoService.beginLogin(`person@${DOMAIN}`);
      const bad = idp.login(again.url, { ...claims(), issuer: "https://evil.example" });
      await failureOf(
        ssoService.handleCallback({ code: bad.code, state: bad.state, binding: again.binding }),
      );
      const retry = idp.login(again.url, claims());
      expect(
        await failureOf(
          ssoService.handleCallback({ code: retry.code, state: bad.state, binding: again.binding }),
        ),
      ).toBe("state_invalid");
    });

    it("refuses a callback from a browser that did not start the sign-in", async () => {
      const requestsBefore = idp.tokenRequests;
      const first = await ssoService.beginLogin(`person@${DOMAIN}`);
      const one = idp.login(first.url, claims());
      expect(
        await failureOf(ssoService.handleCallback({ ...one, binding: "an-attackers-cookie" })),
      ).toBe("state_invalid");
      const second = await ssoService.beginLogin(`person@${DOMAIN}`);
      const two = idp.login(second.url, claims());
      expect(await failureOf(ssoService.handleCallback({ ...two, binding: undefined }))).toBe(
        "state_invalid",
      );
      // Neither attempt got as far as asking the provider for tokens.
      expect(idp.tokenRequests).toBe(requestsBefore);
    });

    it("refuses an email the provider has not verified", async () => {
      expect(
        await failureOf(
          signIn(`person@${DOMAIN}`, {
            claims: { email: `person@${DOMAIN}`, email_verified: false },
          }),
        ),
      ).toBe("email_unverified");
      expect(
        await failureOf(
          signIn(`person@${DOMAIN}`, {
            claims: { email: `person@${DOMAIN}`, email_verified: "true" },
          }),
        ),
      ).toBe("email_unverified");
      await expectNoAccount(`person@${DOMAIN}`);
    });

    it("refuses an address on a domain the organization has not proven", async () => {
      expect(await failureOf(signIn(`person@${DOMAIN}`, claims("person@elsewhere.test")))).toBe(
        "domain_unverified",
      );
      await expectNoAccount("person@elsewhere.test");
    });

    it("finds no provider for an unverified domain", async () => {
      await ssoService.addDomain(ORG_ID, "unproven.test", actor);
      expect(await ssoService.findConnectionForEmail("a@unproven.test")).toBeNull();
      expect(await failureOf(ssoService.beginLogin("a@unproven.test"))).toBe("unavailable");
    });

    it("does not claim an account that belongs to another organization", async () => {
      const victim = await createUser(`victim@${DOMAIN}`, OTHER_ORG_ID, "owner");
      const before = await AppDataSource.getRepository(Session).count({
        where: { userId: victim.id },
      });
      expect(await failureOf(signIn(`victim@${DOMAIN}`, claims(`victim@${DOMAIN}`)))).toBe(
        "account_conflict",
      );
      expect(
        await AppDataSource.getRepository(SsoIdentity).count({ where: { userId: victim.id } }),
      ).toBe(0);
      expect(
        await AppDataSource.getRepository(Session).count({ where: { userId: victim.id } }),
      ).toBe(before);
    });

    it("does not claim an existing account whose email was never verified", async () => {
      await createUser(`pending@${DOMAIN}`, ORG_ID, "member", false);
      expect(await failureOf(signIn(`pending@${DOMAIN}`, claims(`pending@${DOMAIN}`)))).toBe(
        "account_conflict",
      );
    });

    it("does not bring back a removed member or a deactivated account", async () => {
      const removed = await createUser(`removed@${DOMAIN}`, ORG_ID);
      await AppDataSource.getRepository(UserOrganization).update(
        { userId: removed.id },
        { isActive: false },
      );
      expect(await failureOf(signIn(`removed@${DOMAIN}`, claims(`removed@${DOMAIN}`)))).toBe(
        "account_conflict",
      );

      const linked = await signIn(`gone@${DOMAIN}`, claims(`gone@${DOMAIN}`));
      const { user } = await ssoService.redeemTicket(linked);
      await AppDataSource.getRepository(UserOrganization).update(
        { userId: user.id },
        { isActive: false },
      );
      expect(await failureOf(signIn(`gone@${DOMAIN}`, claims(`gone@${DOMAIN}`)))).toBe(
        "not_member",
      );
      await AppDataSource.getRepository(User).update({ id: user.id }, { isActive: false });
      expect(await failureOf(signIn(`gone@${DOMAIN}`, claims(`gone@${DOMAIN}`)))).toBe(
        "account_disabled",
      );
    });

    it("links an existing member of the organization to their provider identity", async () => {
      const member = await createUser(`member@${DOMAIN}`, ORG_ID);
      const ticket = await signIn(`member@${DOMAIN}`, claims(`member@${DOMAIN}`));
      expect((await ssoService.redeemTicket(ticket)).user.id).toBe(member.id);
      expect(
        await AppDataSource.getRepository(SsoIdentity).count({ where: { userId: member.id } }),
      ).toBe(1);
    });

    it("refuses a ticket once the person has left the organization", async () => {
      const ticket = await signIn(`leaver@${DOMAIN}`, claims(`leaver@${DOMAIN}`));
      await AppDataSource.getRepository(UserOrganization).update(
        { organizationId: ORG_ID },
        { isActive: false },
      );
      await expect(
        authRouter.createCaller(publicCtx()).sso.exchange({ ticket }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("domain proof", () => {
    it("needs the TXT record, and tells the owner what to publish", async () => {
      const row = await ssoService.addDomain(ORG_ID, "Proof.Test", actor);
      expect(row.domain).toBe("proof.test");
      mockTxt({});
      await expect(ssoService.verifyDomain(ORG_ID, row.id, actor)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      const [listed] = await ssoService.listDomains(ORG_ID);
      expect(listed.verified).toBe(false);
      expect(listed.challenge?.name).toBe("_hay-sso-challenge.proof.test");
    });

    it("refuses a record carrying the wrong value", async () => {
      const row = await ssoService.addDomain(ORG_ID, "wrong.test", actor);
      mockTxt({ "_hay-sso-challenge.wrong.test": [["hay-sso-verification=not-the-token"]] });
      await expect(ssoService.verifyDomain(ORG_ID, row.id, actor)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("lets only one organization hold a verified domain", async () => {
      await verifiedDomain(OTHER_ORG_ID, "shared.test");
      const claim = await ssoService.addDomain(ORG_ID, "shared.test", actor);
      mockTxt({
        "_hay-sso-challenge.shared.test": [[`hay-sso-verification=${claim.verificationToken}`]],
      });
      await expect(ssoService.verifyDomain(ORG_ID, claim.id, actor)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("rejects things that are not domains", async () => {
      for (const bad of ["localhost", "a b.com", "http://x.com", "1.2.3.4", "x"]) {
        await expect(ssoService.addDomain(ORG_ID, bad, actor)).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      }
    });
  });

  describe("roles", () => {
    beforeEach(async () => {
      await verifiedDomain(ORG_ID, DOMAIN);
    });

    const roleOf = async (email: string) => {
      const user = await AppDataSource.getRepository(User).findOneOrFail({ where: { email } });
      return (
        await AppDataSource.getRepository(UserOrganization).findOneOrFail({
          where: { userId: user.id, organizationId: ORG_ID },
        })
      ).role;
    };

    it("maps a configured claim to a role and takes the highest match", async () => {
      await configure({ roleClaim: "groups", roleMapping: { staff: "viewer", leads: "admin" } });
      await signIn(`lead@${DOMAIN}`, {
        claims: { email: `lead@${DOMAIN}`, sub: "lead", groups: ["staff", "leads"] },
      });
      expect(await roleOf(`lead@${DOMAIN}`)).toBe("admin");
    });

    it("falls back to the default role when nothing matches", async () => {
      await configure({
        defaultRole: "viewer",
        roleClaim: "groups",
        roleMapping: { leads: "admin" },
      });
      await signIn(`none@${DOMAIN}`, {
        claims: { email: `none@${DOMAIN}`, sub: "none", groups: ["other"] },
      });
      expect(await roleOf(`none@${DOMAIN}`)).toBe("viewer");
    });

    it("never grants owner through a claim, even from a stored mapping", async () => {
      await configure({ roleClaim: "groups", roleMapping: { admins: "admin" } });
      await AppDataSource.getRepository(SsoConnection).update(
        { organizationId: ORG_ID },
        { roleMapping: { admins: "owner" as never } },
      );
      await signIn(`root@${DOMAIN}`, {
        claims: { email: `root@${DOMAIN}`, sub: "root", groups: ["admins"] },
      });
      expect(await roleOf(`root@${DOMAIN}`)).toBe("member");
      await expect(
        ssoRouter.createCaller(await ownerCtx(await ownerUser())).saveConnection({
          issuer: idp.issuer,
          clientId: idp.clientId,
          defaultRole: "member",
          roleMapping: { admins: "owner" as never },
          enabled: true,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("leaves an owner's role alone and updates other members when the claim changes", async () => {
      await configure({ roleClaim: "groups", roleMapping: { admins: "admin" } });
      const owner = await createUser(`boss@${DOMAIN}`, ORG_ID, "owner");
      await signIn(`boss@${DOMAIN}`, {
        claims: { email: `boss@${DOMAIN}`, sub: "boss", groups: [] },
      });
      expect(await roleOf(owner.email)).toBe("owner");

      await signIn(`pat@${DOMAIN}`, {
        claims: { email: `pat@${DOMAIN}`, sub: "pat", groups: ["admins"] },
      });
      expect(await roleOf(`pat@${DOMAIN}`)).toBe("admin");
      await signIn(`pat@${DOMAIN}`, { claims: { email: `pat@${DOMAIN}`, sub: "pat", groups: [] } });
      expect(await roleOf(`pat@${DOMAIN}`)).toBe("member");
    });
  });

  async function ownerUser(): Promise<User> {
    const existing = await AppDataSource.getRepository(User).findOne({
      where: { email: `owner@${DOMAIN}` },
    });
    return existing ?? createUser(`owner@${DOMAIN}`, ORG_ID, "owner");
  }

  describe("configuration", () => {
    it("is for owners only", async () => {
      const member = await createUser(`plain@${DOMAIN}`, ORG_ID, "member");
      await expect(
        ssoRouter.createCaller(await ownerCtx(member)).getSettings(),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("stores the client secret encrypted and never returns it", async () => {
      await configure();
      const row = await AppDataSource.getRepository(SsoConnection).findOneOrFail({
        where: { organizationId: ORG_ID },
      });
      expect(row.clientSecret.startsWith("enc:v3:")).toBe(true);
      expect(row.clientSecret).not.toContain(idp.clientSecret);
      const view = await ssoService.getConnection(ORG_ID);
      expect(JSON.stringify(view)).not.toContain('clientSecret":"');
      expect(view).not.toHaveProperty("clientSecret");
    });

    it("needs a secret the first time and keeps it when omitted later", async () => {
      await expect(configure({ clientSecret: undefined })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await configure();
      const before = (
        await AppDataSource.getRepository(SsoConnection).findOneOrFail({
          where: { organizationId: ORG_ID },
        })
      ).clientSecret;
      await configure({ clientSecret: undefined, defaultRole: "viewer" });
      const after = await AppDataSource.getRepository(SsoConnection).findOneOrFail({
        where: { organizationId: ORG_ID },
      });
      expect(after.clientSecret).toBe(before);
      expect(after.defaultRole).toBe("viewer");
    });

    it("audits changes without the secret", async () => {
      await configure();
      const rows = await AppDataSource.getRepository(AuditLog).find({
        where: { organizationId: ORG_ID, action: "sso.config.update" },
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows[0].changes)).not.toContain(idp.clientSecret);
      expect(rows[0].changes).toMatchObject({ clientSecretChanged: true, issuer: idp.issuer });
    });
  });

  describe("enforcement", () => {
    let owner: User;
    let member: User;

    beforeEach(async () => {
      await verifiedDomain(ORG_ID, DOMAIN);
      await configure();
      owner = await ownerUser();
      member = await createUser(`worker@${DOMAIN}`, ORG_ID);
      actor.userId = owner.id;
    });

    const membershipOf = (user: User, organizationId = ORG_ID) =>
      AppDataSource.getRepository(UserMfa)
        .manager.getRepository(UserOrganization)
        .findOneOrFail({ where: { userId: user.id, organizationId }, relations: ["organization"] });

    async function addSecondFactor(user: User) {
      const repo = AppDataSource.getRepository(UserMfa);
      await repo.delete({ userId: user.id });
      await repo.save(
        repo.create({
          userId: user.id,
          secret: "enc:v3:placeholder",
          confirmedAt: new Date(),
          recoveryCodes: [],
        }),
      );
    }

    async function enforce() {
      await signIn(`worker@${DOMAIN}`, { claims: { email: `worker@${DOMAIN}`, sub: "worker" } });
      await addSecondFactor(owner);
      await ssoService.setEnforcement(ORG_ID, true, { ...actor, role: "owner" });
    }

    it("is refused until the provider has signed someone in", async () => {
      await addSecondFactor(owner);
      await expect(
        ssoService.setEnforcement(ORG_ID, true, { ...actor, role: "owner" }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("is refused for an owner who could not get back in without the provider", async () => {
      await signIn(`worker@${DOMAIN}`, { claims: { email: `worker@${DOMAIN}`, sub: "worker" } });
      await expect(
        ssoService.setEnforcement(ORG_ID, true, { ...actor, role: "owner" }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      await addSecondFactor(owner);
      await expect(
        ssoService.setEnforcement(ORG_ID, true, { ...actor, role: "admin" }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("turns away password sessions of members but lets an owner with a second factor in", async () => {
      await enforce();
      const membership = await membershipOf(member);
      expect(membership.organization.settings?.ssoEnforced).toBe(true);
      await expect(assertSsoPolicy({ id: member.id }, membership)).rejects.toMatchObject({
        cause: { type: "SSO_REQUIRED" },
      });
      await expect(
        assertSsoPolicy({ id: owner.id }, await membershipOf(owner)),
      ).resolves.toBeUndefined();
    });

    it("turns away an owner without a second factor", async () => {
      await enforce();
      await AppDataSource.getRepository(UserMfa).delete({ userId: owner.id });
      await expect(
        assertSsoPolicy({ id: owner.id }, await membershipOf(owner)),
      ).rejects.toMatchObject({
        cause: { type: "SSO_REQUIRED" },
      });
    });

    it("lets a session from the provider through, and no further than this organization", async () => {
      await enforce();
      await expect(
        assertSsoPolicy({ id: member.id, ssoOrganizationId: ORG_ID }, await membershipOf(member)),
      ).resolves.toBeUndefined();

      await AppDataSource.getRepository(UserOrganization).save(
        AppDataSource.getRepository(UserOrganization).create({
          userId: member.id,
          organizationId: OTHER_ORG_ID,
          role: "member",
          isActive: true,
        }),
      );
      await expect(
        assertSsoPolicy(
          { id: member.id, ssoOrganizationId: ORG_ID },
          await membershipOf(member, OTHER_ORG_ID),
        ),
      ).rejects.toMatchObject({ cause: { type: "SSO_SESSION_SCOPE" } });
      // The other organization does not enforce anything: a password session still works there.
      await expect(
        assertSsoPolicy({ id: member.id }, await membershipOf(member, OTHER_ORG_ID)),
      ).resolves.toBeUndefined();
    });

    it("is lifted when the provider's credentials change or the connection is switched off", async () => {
      await enforce();
      await configure({ clientId: idp.clientId, defaultRole: "viewer" });
      expect((await membershipOf(member)).organization.settings?.ssoEnforced).toBe(true);

      await configure({ enabled: false });
      expect((await membershipOf(member)).organization.settings?.ssoEnforced).toBe(false);
      const connection = await AppDataSource.getRepository(SsoConnection).findOneOrFail({
        where: { organizationId: ORG_ID },
      });
      expect(connection.enabled).toBe(false);
    });

    it("is lifted when the connection is deleted or the last verified domain removed", async () => {
      await enforce();
      const [domain] = await ssoService.listDomains(ORG_ID);
      await ssoService.removeDomain(ORG_ID, domain.id, actor);
      expect((await membershipOf(member)).organization.settings?.ssoEnforced).toBe(false);

      await verifiedDomain(ORG_ID, DOMAIN);
      await configure();
      await enforce();
      await ssoService.deleteConnection(ORG_ID, actor);
      expect((await membershipOf(member)).organization.settings?.ssoEnforced).toBe(false);
    });

    it("skips Hay's own second-factor requirement for provider sessions only", async () => {
      await enforce();
      await AppDataSource.query(
        `UPDATE organizations SET settings = jsonb_set(settings, '{mfaRequired}', 'true') WHERE id = $1`,
        [ORG_ID],
      );
      const membership = await membershipOf(member);
      const viaProvider = new AuthUser(member, "jwt", {
        sessionId: "s",
        organizationId: ORG_ID,
        userOrganization: membership,
        ssoOrganizationId: ORG_ID,
      });
      const viaPassword = new AuthUser(member, "jwt", {
        sessionId: "s",
        organizationId: ORG_ID,
        userOrganization: membership,
      });
      await expect(mfaService.assertEnrolledIfRequired(viaProvider)).resolves.toBeUndefined();
      await expect(mfaService.assertEnrolledIfRequired(viaPassword)).rejects.toBeDefined();
      expect(await mfaService.enrolmentRequired(member.id, ORG_ID)).toBe(false);
      expect(await mfaService.enrolmentRequired(member.id)).toBe(true);
    });

    it("does not skip it when SSO is not enforced", async () => {
      await AppDataSource.query(
        `UPDATE organizations SET settings = jsonb_set(COALESCE(settings, '{}'), '{mfaRequired}', 'true') WHERE id = $1`,
        [ORG_ID],
      );
      const membership = await membershipOf(member);
      const viaProvider = new AuthUser(member, "jwt", {
        sessionId: "s",
        organizationId: ORG_ID,
        userOrganization: membership,
        ssoOrganizationId: ORG_ID,
      });
      await expect(mfaService.assertEnrolledIfRequired(viaProvider)).rejects.toBeDefined();
    });
  });
});
