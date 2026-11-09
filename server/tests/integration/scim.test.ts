/**
 * SCIM 2.0 provisioning for one organization per token: what a token can reach, the
 * requests Okta and Entra send, and what deprovisioning ends.
 */
process.env.API_DOMAIN = "api.hay-scim.test";
process.env.DASHBOARD_DOMAIN = "app.hay-scim.test";
process.env.CONNECT_ALLOWED_REDIRECT_ORIGINS = "https://billing.example.test";

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
import type { AddressInfo } from "net";
import type { Server } from "http";
import express, { type Request } from "express";
import { In, MoreThanOrEqual } from "typeorm";

const limiter = {
  counts: new Map<string, number>(),
  /** Lowers every per-key limit so a test can reach it quickly. */
  keyCap: undefined as number | undefined,
  reset() {
    this.counts.clear();
    this.keyCap = undefined;
  },
  hit(key: string, max: number) {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { limited: count > (this.keyCap ?? max) };
  },
};
jest.mock("../../services/rate-limit.service", () => ({
  rateLimitService: {
    checkIpRateLimit: async (ip: string, max: number, _w: number, o: { scope: string }) =>
      limiter.hit(`ip:${o.scope}:${ip}`, max),
    checkKeyRateLimit: async (key: string, max: number) => limiter.hit(key, max),
    checkEmailRateLimit: async () => ({ limited: false }),
    resetRateLimit: async () => undefined,
  },
}));
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
  redisService: {
    isConnected: () => true,
    getClient: () => mockRedis.client,
    subscribe: async () => undefined,
  },
}));
jest.mock("../../services/email.service", () => ({
  emailService: { initialize: async () => undefined, sendTemplateEmail: async () => ({}) },
  getOrganizationLocale: async () => "en",
}));
jest.mock("../../services/default-plugins.service", () => ({
  enableDefaultPlugins: async () => undefined,
}));

import { AppDataSource } from "../../database/data-source";
import { ScimGroup } from "../../database/entities/scim-group.entity";
import { ScimToken } from "../../database/entities/scim-token.entity";
import { SsoConnection } from "../../database/entities/sso-connection.entity";
import { SsoDomain } from "../../database/entities/sso-domain.entity";
import { SsoIdentity } from "../../database/entities/sso-identity.entity";
import { UserMfa } from "../../database/entities/user-mfa.entity";
import { ApiKey } from "../../entities/apikey.entity";
import { AuditLog } from "../../entities/audit-log.entity";
import { Organization } from "../../entities/organization.entity";
import { Session } from "../../entities/session.entity";
import { User } from "../../entities/user.entity";
import { UserOrganization } from "../../entities/user-organization.entity";
import { AuthUser } from "../../lib/auth/AuthUser";
import { authenticate } from "../../lib/auth/middleware";
import { hashApiKey, hashPassword } from "../../lib/auth/utils/hashing";
import { parseGroupPatch, parseUserPatch } from "../../lib/scim/patch";
import scimRoutes from "../../routes/scim";
import { authRouter } from "../../routes/v1/auth";
import { ssoRouter } from "../../routes/v1/sso";
import { authSessionService, RefreshRejectedError } from "../../services/auth-session.service";
import { roleForGroups } from "../../services/scim.service";
import { SsoLoginError, ssoService } from "../../services/sso.service";
import { WebSocketService, websocketService } from "../../services/websocket.service";
import type { Context } from "../../trpc/context";

const DOMAIN = "scim-a.test";
const DOMAIN_B = "scim-b.test";
const ORG_A = "5c1d0000-0000-4000-8000-0000000000a1";
const ORG_B = "5c1d0000-0000-4000-8000-0000000000b2";
const SCIM_JSON = "application/scim+json";

let server: Server;
let base: string;
let tokenA = "";
let tokenB = "";
let ownerA: User;
let testStart = new Date();

/** Audit rows written during this test; earlier tests' rows outlive their organizations. */
const auditRows = (action: string) =>
  AppDataSource.getRepository(AuditLog).find({
    where: { action: action as AuditLog["action"], createdAt: MoreThanOrEqual(testStart) },
  });

async function createUser(
  email: string,
  orgs: Array<[string, "owner" | "member" | "admin"]>,
  options: { emailVerified?: boolean } = {},
): Promise<User> {
  const users = AppDataSource.getRepository(User);
  const user = await users.save(
    users.create({
      email,
      password: await hashPassword("CorrectHorse9!"),
      firstName: "First",
      lastName: "Last",
      isActive: true,
      emailVerified: options.emailVerified ?? true,
    }),
  );
  const memberships = AppDataSource.getRepository(UserOrganization);
  for (const [organizationId, role] of orgs) {
    await memberships.save(
      memberships.create({ userId: user.id, organizationId, role, isActive: true }),
    );
  }
  return user;
}

async function ownerCtx(user: User, organizationId: string): Promise<Context> {
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

interface ScimResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
}

async function scim<T = Record<string, unknown>>(
  method: string,
  path: string,
  options: { token?: string | null; body?: unknown; contentType?: string } = {},
): Promise<ScimResponse<T>> {
  const token = options.token === undefined ? tokenA : options.token;
  const res = await fetch(`${base}/scim/v2${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body !== undefined ? { "Content-Type": options.contentType ?? SCIM_JSON } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : {}) as T };
}

const patch = (operations: unknown[]) => ({
  schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  Operations: operations,
});

type UserResource = {
  id: string;
  userName: string;
  active: boolean;
  externalId?: string;
  name?: { givenName?: string; familyName?: string };
  groups?: Array<{ value: string; display: string }>;
  meta: { location: string };
};
type ListResource = { totalResults: number; itemsPerPage: number; Resources: UserResource[] };

async function provision(local: string, extra: Record<string, unknown> = {}) {
  const res = await scim<UserResource>("POST", "/Users", {
    body: {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: `${local}@${DOMAIN}`,
      name: { givenName: "Pat", familyName: "Lee" },
      ...extra,
    },
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function cleanup() {
  const emails = await AppDataSource.getRepository(User)
    .createQueryBuilder("u")
    .where("u.email LIKE :a OR u.email LIKE :b", { a: `%@${DOMAIN}`, b: `%@${DOMAIN_B}` })
    .getMany();
  const ids = emails.map((u) => u.id);
  if (ids.length) {
    await AppDataSource.getRepository(ApiKey).delete({ createdByUserId: In(ids) });
    await AppDataSource.getRepository(Session).delete({ userId: In(ids) });
    await AppDataSource.getRepository(UserMfa).delete({ userId: In(ids) });
    await AppDataSource.getRepository(UserOrganization).delete({ userId: In(ids) });
    await AppDataSource.getRepository(User).delete({ id: In(ids) });
  }
  await AppDataSource.getRepository(Organization).delete({ id: In([ORG_A, ORG_B]) });
}

describe("SCIM", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const app = express();
    app.use(scimRoutes);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    testStart = new Date();
    limiter.reset();
    mockRedis.values.clear();
    await cleanup();
    const orgs = AppDataSource.getRepository(Organization);
    await orgs.save(orgs.create({ id: ORG_A, name: "Acme", slug: "scim-a" }));
    await orgs.save(orgs.create({ id: ORG_B, name: "Other", slug: "scim-b" }));
    const domains = AppDataSource.getRepository(SsoDomain);
    for (const [organizationId, domain] of [
      [ORG_A, DOMAIN],
      [ORG_B, DOMAIN_B],
    ]) {
      await domains.save(
        domains.create({ organizationId, domain, verificationToken: "t", verifiedAt: new Date() }),
      );
    }
    ownerA = await createUser(`boss@${DOMAIN}`, [[ORG_A, "owner"]]);
    const ownerB = await createUser(`boss@${DOMAIN_B}`, [[ORG_B, "owner"]]);
    tokenA = (await ssoRouter.createCaller(await ownerCtx(ownerA, ORG_A)).createScimToken()).token;
    tokenB = (await ssoRouter.createCaller(await ownerCtx(ownerB, ORG_B)).createScimToken()).token;
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await cleanup();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  describe("the token", () => {
    it("is shown once, stored only as a hash, and created by owners only", async () => {
      const row = await AppDataSource.getRepository(ScimToken).findOneOrFail({
        where: { organizationId: ORG_A },
      });
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(tokenA);
      expect(tokenA.startsWith("hay_scim_")).toBe(true);

      const member = await createUser(`plain@${DOMAIN}`, [[ORG_A, "member"]]);
      await expect(
        ssoRouter.createCaller(await ownerCtx(member, ORG_A)).createScimToken(),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        ssoRouter.createCaller(await ownerCtx(member, ORG_A)).revokeScimToken(),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const settings = await ssoRouter.createCaller(await ownerCtx(ownerA, ORG_A)).getSettings();
      expect(settings.scim.token?.prefix).toBe(tokenA.slice(0, 13));
      expect(JSON.stringify(settings)).not.toContain(tokenA);
    });

    it("is replaced when another is created, and stops working when revoked", async () => {
      const ctx = await ownerCtx(ownerA, ORG_A);
      const next = (await ssoRouter.createCaller(ctx).createScimToken()).token;
      expect((await scim("GET", "/Users", { token: tokenA })).status).toBe(401);
      expect((await scim("GET", "/Users", { token: next })).status).toBe(200);
      await ssoRouter.createCaller(ctx).revokeScimToken();
      expect((await scim("GET", "/Users", { token: next })).status).toBe(401);
    });

    it("is audited when created and revoked", async () => {
      await ssoRouter.createCaller(await ownerCtx(ownerA, ORG_A)).revokeScimToken();
      const actions = [
        ...(await auditRows("scim.token.create")),
        ...(await auditRows("scim.token.revoke")),
      ]
        .filter((row) => row.organizationId === ORG_A)
        .map((row) => row.action);
      expect(actions).toEqual(expect.arrayContaining(["scim.token.create", "scim.token.revoke"]));
    });

    it("is refused when missing, malformed or wrong, in the SCIM error format", async () => {
      for (const token of [null, "hay_scim_wrong", "not-a-token"]) {
        const res = await scim("GET", "/Users", { token });
        expect(res.status).toBe(401);
        expect(res.headers.get("content-type")).toContain(SCIM_JSON);
        expect(res.headers.get("www-authenticate")).toContain("Bearer");
        expect(res.body).toMatchObject({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          status: "401",
        });
      }
    });

    it("records a failed attempt once per window, without the token", async () => {
      await scim("GET", "/Users", { token: "hay_scim_guess_one" });
      await scim("GET", "/Users", { token: "hay_scim_guess_two" });
      const rows = await auditRows("scim.auth_failed");
      expect(rows.length).toBe(1);
      expect(JSON.stringify(rows)).not.toContain("guess");
    });

    it("is rate limited, and so is a client guessing tokens", async () => {
      limiter.keyCap = 3;
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) statuses.push((await scim("GET", "/Users")).status);
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
      const limited = await scim("GET", "/Users");
      expect(limited.headers.get("retry-after")).toBe("60");
      expect(limited.body).toMatchObject({ status: "429" });
      // Another organization's token has its own allowance.
      expect((await scim("GET", "/Users", { token: tokenB })).status).toBe(200);

      limiter.reset();
      for (let i = 0; i < 60; i += 1) await scim("GET", "/Users", { token: `hay_scim_g${i}` });
      expect((await scim("GET", "/Users", { token: "hay_scim_more" })).status).toBe(429);
    });

    it("answers 401 and shows no token while the tables are missing, as before migrations run", async () => {
      await AppDataSource.query(`ALTER TABLE scim_tokens RENAME TO scim_tokens_pending`);
      try {
        const res = await scim("GET", "/Users");
        expect(res.status).toBe(401);
        const settings = await ssoRouter.createCaller(await ownerCtx(ownerA, ORG_A)).getSettings();
        expect(settings.scim.token).toBeNull();
      } finally {
        await AppDataSource.query(`ALTER TABLE scim_tokens_pending RENAME TO scim_tokens`);
      }
    });
  });

  describe("discovery", () => {
    it("describes the service, its resource types and schemas", async () => {
      const config = await scim<{
        patch: { supported: boolean };
        bulk: { supported: boolean };
        authenticationSchemes: unknown[];
      }>("GET", "/ServiceProviderConfig");
      expect(config.status).toBe(200);
      expect(config.body.patch.supported).toBe(true);
      expect(config.body.bulk.supported).toBe(false);
      expect(config.body.authenticationSchemes).toHaveLength(1);

      const types = await scim<{ Resources: Array<{ id: string; endpoint: string }> }>(
        "GET",
        "/ResourceTypes",
      );
      expect(types.body.Resources.map((t) => [t.id, t.endpoint])).toEqual([
        ["User", "/Users"],
        ["Group", "/Groups"],
      ]);
      expect((await scim("GET", "/ResourceTypes/User")).status).toBe(200);
      const schemas = await scim<{ Resources: Array<{ id: string }> }>("GET", "/Schemas");
      expect(schemas.body.Resources.map((s) => s.id)).toEqual([
        "urn:ietf:params:scim:schemas:core:2.0:User",
        "urn:ietf:params:scim:schemas:core:2.0:Group",
      ]);
      expect(
        (await scim("GET", "/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group")).status,
      ).toBe(200);
      expect((await scim("GET", "/Schemas/nope")).status).toBe(404);
    });

    it("needs the token too, and answers unknown paths in the SCIM format", async () => {
      expect((await scim("GET", "/ServiceProviderConfig", { token: null })).status).toBe(401);
      const missing = await scim("GET", "/Nothing");
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ status: "404" });
    });
  });

  describe("creating users", () => {
    it("creates a person on a verified domain with the connection's default role", async () => {
      await AppDataSource.getRepository(SsoConnection).save(
        AppDataSource.getRepository(SsoConnection).create({
          organizationId: ORG_A,
          protocol: "saml",
          issuer: "https://idp.example/metadata",
          samlEntryPoint: "https://idp.example/sso",
          samlCertificate: "x",
          defaultRole: "viewer",
          roleMapping: {},
          enabled: false,
        }),
      );
      const user = await provision("new", { externalId: "ext-1", active: true });
      expect(user).toMatchObject({
        userName: `new@${DOMAIN}`,
        externalId: "ext-1",
        active: true,
        name: { givenName: "Pat", familyName: "Lee" },
      });
      expect(user.meta.location).toContain(`/scim/v2/Users/${user.id}`);
      const row = await AppDataSource.getRepository(User).findOneOrFail({ where: { id: user.id } });
      expect(row.emailVerified).toBe(true);
      const membership = await AppDataSource.getRepository(UserOrganization).findOneOrFail({
        where: { userId: user.id, organizationId: ORG_A },
      });
      expect(membership).toMatchObject({ role: "viewer", isActive: true });
      expect(await auditRows("scim.user.create")).toHaveLength(1);
    });

    it("takes the primary email when userName is not an address, and lower-cases it", async () => {
      const res = await scim<UserResource>("POST", "/Users", {
        body: { userName: "plb", emails: [{ value: `Mixed.Case@${DOMAIN}`, primary: true }] },
      });
      expect(res.status).toBe(201);
      expect(res.body.userName).toBe(`mixed.case@${DOMAIN}`);
    });

    it("refuses an address outside the organization's verified domains", async () => {
      for (const userName of [
        "a@elsewhere.example",
        `b@${DOMAIN_B}`,
        "not-an-email",
        `c@sub.${DOMAIN}`,
      ]) {
        const res = await scim("POST", "/Users", { body: { userName } });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ scimType: "invalidValue" });
      }
      expect(
        await AppDataSource.getRepository(User).count({ where: { email: `b@${DOMAIN_B}` } }),
      ).toBe(0);
    });

    it("refuses a domain that is added but not proven", async () => {
      await AppDataSource.getRepository(SsoDomain).save(
        AppDataSource.getRepository(SsoDomain).create({
          organizationId: ORG_A,
          domain: "unproven.test",
          verificationToken: "t",
        }),
      );
      const res = await scim("POST", "/Users", { body: { userName: "x@unproven.test" } });
      expect(res.status).toBe(400);
    });

    it("answers 409 for a duplicate, and never claims an account that lives elsewhere", async () => {
      await provision("dup");
      const twice = await scim("POST", "/Users", { body: { userName: `DUP@${DOMAIN}` } });
      expect(twice.status).toBe(409);
      expect(twice.body).toMatchObject({ scimType: "uniqueness" });

      const elsewhere = await createUser(`away@${DOMAIN}`, [[ORG_B, "member"]]);
      const res = await scim("POST", "/Users", {
        body: { userName: `away@${DOMAIN}`, name: { givenName: "Changed" } },
      });
      expect(res.status).toBe(409);
      const after = await AppDataSource.getRepository(User).findOneOrFail({
        where: { id: elsewhere.id },
      });
      expect(after.firstName).toBe("First");
      expect(
        await AppDataSource.getRepository(UserOrganization).count({
          where: { userId: elsewhere.id, organizationId: ORG_A },
        }),
      ).toBe(0);
    });

    it("answers 409 for an externalId already in use", async () => {
      await provision("one", { externalId: "same" });
      const res = await scim("POST", "/Users", {
        body: { userName: `two@${DOMAIN}`, externalId: "same" },
      });
      expect(res.status).toBe(409);
      expect(
        await AppDataSource.getRepository(User).count({ where: { email: `two@${DOMAIN}` } }),
      ).toBe(0);
    });

    it("rejects a body that is not JSON, not an object, or the wrong media type", async () => {
      const raw = await fetch(`${base}/scim/v2/Users`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": SCIM_JSON },
        body: "{not json",
      });
      expect(raw.status).toBe(400);
      expect(await raw.json()).toMatchObject({ scimType: "invalidSyntax" });
      const wrong = await scim("POST", "/Users", {
        body: { userName: `x@${DOMAIN}` },
        contentType: "text/plain",
      });
      expect(wrong.status).toBe(400);
      const none = await scim("POST", "/Users", { body: {} });
      expect(none.status).toBe(400);
      const big = await fetch(`${base}/scim/v2/Users`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": SCIM_JSON },
        body: JSON.stringify({ userName: `x@${DOMAIN}`, pad: "x".repeat(300_000) }),
      });
      expect(big.status).toBe(413);
    });
  });

  describe("reading users", () => {
    let alice: UserResource;
    let carol: UserResource;

    beforeEach(async () => {
      alice = await provision("alice", { externalId: "e-alice" });
      await provision("bob", {
        externalId: "e-bob",
        name: { givenName: "Bob", familyName: "Stone" },
      });
      carol = await provision("carol", { active: false });
    });

    const names = (list: ListResource) =>
      list.Resources.map((r) => r.userName.split("@")[0]).sort();

    it("gets one and lists them with the owner, paged", async () => {
      expect((await scim<UserResource>("GET", `/Users/${alice.id}`)).body.userName).toBe(
        `alice@${DOMAIN}`,
      );
      const all = await scim<ListResource>("GET", "/Users");
      expect(all.body.totalResults).toBe(4);
      expect(names(all.body)).toEqual(["alice", "bob", "boss", "carol"]);
      const page = await scim<ListResource>("GET", "/Users?startIndex=2&count=2");
      expect(page.body).toMatchObject({ totalResults: 4, startIndex: 2, itemsPerPage: 2 });
      const none = await scim<ListResource>("GET", "/Users?count=0");
      expect(none.body).toMatchObject({ totalResults: 4, itemsPerPage: 0 });
      expect((await scim("GET", "/Users?count=abc")).status).toBe(400);
    });

    it("supports the filters Okta and Entra send", async () => {
      const filter = async (expression: string) =>
        names(
          (await scim<ListResource>("GET", `/Users?filter=${encodeURIComponent(expression)}`)).body,
        );
      expect(await filter(`userName eq "alice@${DOMAIN}"`)).toEqual(["alice"]);
      expect(await filter(`userName eq "ALICE@${DOMAIN.toUpperCase()}"`)).toEqual(["alice"]);
      expect(await filter(`externalId eq "e-bob"`)).toEqual(["bob"]);
      expect(await filter(`emails.value eq "bob@${DOMAIN}"`)).toEqual(["bob"]);
      expect(await filter(`id eq "${carol.id}"`)).toEqual(["carol"]);
      expect(await filter(`active eq false`)).toEqual(["carol"]);
      expect(await filter(`active eq true`)).toEqual(["alice", "bob", "boss"]);
      expect(await filter(`userName sw "al"`)).toEqual(["alice"]);
      expect(await filter(`userName co "ob"`)).toEqual(["bob"]);
      expect(await filter(`userName ew "@${DOMAIN}" and name.familyName eq "Stone"`)).toEqual([
        "bob",
      ]);
      expect(await filter(`externalId eq "e-alice" or externalId eq "e-bob"`)).toEqual([
        "alice",
        "bob",
      ]);
      expect(await filter(`not (externalId pr)`)).toEqual(["boss", "carol"]);
      expect(
        await filter(`urn:ietf:params:scim:schemas:core:2.0:User:userName eq "bob@${DOMAIN}"`),
      ).toEqual(["bob"]);
      expect(await filter(`userName eq "nobody@${DOMAIN}"`)).toEqual([]);
    });

    it("refuses a filter it cannot run, and treats values as text, never as SQL", async () => {
      for (const bad of [
        "userName eq",
        'userName xx "a"',
        'password eq "a"',
        '(userName eq "a"',
        'active eq "maybe"',
      ]) {
        const res = await scim("GET", `/Users?filter=${encodeURIComponent(bad)}`);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ scimType: "invalidFilter" });
      }
      const injection = await scim<ListResource>(
        "GET",
        `/Users?filter=${encodeURIComponent(`userName eq "x' OR '1'='1" or userName eq "\\" OR 1=1 --"`)}`,
      );
      expect(injection.status).toBe(200);
      expect(injection.body.totalResults).toBe(0);
      expect(
        await AppDataSource.getRepository(User).count({ where: { email: `alice@${DOMAIN}` } }),
      ).toBe(1);
      const deep = `${"(".repeat(30)}userName eq "a"${")".repeat(30)}`;
      expect((await scim("GET", `/Users?filter=${encodeURIComponent(deep)}`)).status).toBe(400);
    });

    it("does not show another organization's people, by id, list or filter", async () => {
      const other = await createUser(`stranger@${DOMAIN_B}`, [[ORG_B, "member"]]);
      expect((await scim("GET", `/Users/${other.id}`)).status).toBe(404);
      expect((await scim("GET", "/Users/not-a-uuid")).status).toBe(404);
      const list = await scim<ListResource>(
        "GET",
        `/Users?filter=${encodeURIComponent(`userName eq "stranger@${DOMAIN_B}"`)}`,
      );
      expect(list.body.totalResults).toBe(0);
      expect(names((await scim<ListResource>("GET", "/Users")).body)).not.toContain("stranger");
      // The other organization's token sees its own people.
      expect((await scim<ListResource>("GET", "/Users", { token: tokenB })).body.totalResults).toBe(
        2,
      );
    });

    it("reaches no other organization's person for any change", async () => {
      const other = await createUser(`stranger2@${DOMAIN_B}`, [[ORG_B, "member"]]);
      for (const [method, body] of [
        ["PATCH", patch([{ op: "replace", value: { active: false } }])],
        ["PUT", { userName: `stranger2@${DOMAIN_B}`, active: false }],
        ["DELETE", undefined],
      ] as const) {
        expect((await scim(method, `/Users/${other.id}`, { body })).status).toBe(404);
      }
      const after = await AppDataSource.getRepository(UserOrganization).findOneOrFail({
        where: { userId: other.id, organizationId: ORG_B },
      });
      expect(after.isActive).toBe(true);
    });
  });

  describe("changing users", () => {
    it("deactivates with Okta's pathless patch and reactivates with Entra's text boolean", async () => {
      const user = await provision("flip");
      const off = await scim<UserResource>("PATCH", `/Users/${user.id}`, {
        body: patch([{ op: "replace", value: { active: false } }]),
      });
      expect(off.body.active).toBe(false);
      const on = await scim<UserResource>("PATCH", `/Users/${user.id}`, {
        body: patch([{ op: "Replace", path: "active", value: "True" }]),
      });
      expect(on.body.active).toBe(true);
      const row = await AppDataSource.getRepository(User).findOneOrFail({ where: { id: user.id } });
      expect(row.isActive).toBe(true);
    });

    it("updates names with a path or an object, and the external id", async () => {
      const user = await provision("names");
      const res = await scim<UserResource>("PATCH", `/Users/${user.id}`, {
        body: patch([
          { op: "replace", path: "name.givenName", value: "Ada" },
          { op: "replace", value: { name: { familyName: "Byron" }, externalId: "e-1" } },
          { op: "add", path: "phoneNumbers", value: [{ value: "+1" }] },
        ]),
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        externalId: "e-1",
        name: { givenName: "Ada", familyName: "Byron" },
      });
      const cleared = await scim<UserResource>("PATCH", `/Users/${user.id}`, {
        body: patch([{ op: "remove", path: "externalId" }]),
      });
      expect(cleared.body.externalId).toBeUndefined();
    });

    it("replaces with PUT, leaving out what the body does not name", async () => {
      const user = await provision("put", { externalId: "keep" });
      const res = await scim<UserResource>("PUT", `/Users/${user.id}`, {
        body: {
          userName: `put@${DOMAIN}`,
          name: { givenName: "New", familyName: "Name" },
          active: true,
        },
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ externalId: "keep", name: { givenName: "New" } });
    });

    it("refuses an address change for an account that is used elsewhere, and changes a sole one safely", async () => {
      const shared = await createUser(`shared@${DOMAIN}`, [
        [ORG_A, "member"],
        [ORG_B, "member"],
      ]);
      const refused = await scim("PATCH", `/Users/${shared.id}`, {
        body: patch([{ op: "replace", path: "userName", value: `renamed@${DOMAIN}` }]),
      });
      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({ scimType: "mutability" });

      const user = await provision("moving");
      await AppDataSource.getRepository(SsoIdentity).save(
        AppDataSource.getRepository(SsoIdentity).create({
          organizationId: ORG_A,
          userId: user.id,
          issuer: "https://idp.example/metadata",
          subject: "old-subject",
        }),
      );
      const moved = await scim<UserResource>("PATCH", `/Users/${user.id}`, {
        body: patch([{ op: "replace", path: "userName", value: `moved@${DOMAIN}` }]),
      });
      expect(moved.body.userName).toBe(`moved@${DOMAIN}`);
      expect(
        await AppDataSource.getRepository(SsoIdentity).count({ where: { userId: user.id } }),
      ).toBe(0);
      const clash = await scim("PATCH", `/Users/${user.id}`, {
        body: patch([{ op: "replace", path: "userName", value: `boss@${DOMAIN}` }]),
      });
      expect(clash.status).toBe(409);
      const outside = await scim("PATCH", `/Users/${user.id}`, {
        body: patch([{ op: "replace", path: "userName", value: `x@${DOMAIN_B}` }]),
      });
      expect(outside.status).toBe(400);
    });

    it("changes nothing on the account of a person who also belongs to another organization", async () => {
      const shared = await createUser(`dual@${DOMAIN}`, [
        [ORG_A, "member"],
        [ORG_B, "member"],
      ]);
      const res = await scim<UserResource>("PATCH", `/Users/${shared.id}`, {
        body: patch([{ op: "replace", value: { name: { givenName: "Overwritten" } } }]),
      });
      expect(res.status).toBe(200);
      const after = await AppDataSource.getRepository(User).findOneOrFail({
        where: { id: shared.id },
      });
      expect(after.firstName).toBe("First");
    });

    it("rejects patches that make no sense", async () => {
      const user = await provision("bad");
      for (const body of [
        { schemas: [], Operations: [] },
        patch([{ op: "frobnicate", path: "active", value: true }]),
        patch([{ op: "replace", path: "active", value: "perhaps" }]),
        patch([{ op: "replace", value: "active" }]),
        patch([{ op: "remove" }]),
      ]) {
        const res = await scim("PATCH", `/Users/${user.id}`, { body });
        expect(res.status).toBe(400);
      }
    });
  });

  describe("owners", () => {
    it("are readable but never changed, deactivated or removed through SCIM", async () => {
      const read = await scim<UserResource>("GET", `/Users/${ownerA.id}`);
      expect(read.status).toBe(200);
      for (const [method, body] of [
        ["PATCH", patch([{ op: "replace", value: { active: false } }])],
        ["PATCH", patch([{ op: "replace", path: "name.givenName", value: "X" }])],
        ["PUT", { userName: `boss@${DOMAIN}`, active: false }],
        ["DELETE", undefined],
      ] as const) {
        const res = await scim(method, `/Users/${ownerA.id}`, { body });
        expect(res.status).toBe(403);
      }
      const row = await AppDataSource.getRepository(User).findOneOrFail({
        where: { id: ownerA.id },
      });
      const membership = await AppDataSource.getRepository(UserOrganization).findOneOrFail({
        where: { userId: ownerA.id, organizationId: ORG_A },
      });
      expect(row).toMatchObject({ isActive: true, firstName: "First" });
      expect(membership).toMatchObject({ isActive: true, role: "owner" });
    });
  });

  describe("deprovisioning", () => {
    async function apiKeyFor(user: User, organizationId: string) {
      const keys = AppDataSource.getRepository(ApiKey);
      return keys.save(
        keys.create({
          organizationId,
          name: "key",
          keyHash: `hash-${Math.random()}`,
          scopes: [],
          isActive: true,
          createdByUserId: user.id,
        }),
      );
    }

    it("for a person with one organization ends everything and deactivates the account", async () => {
      const resource = await provision("leaver");
      const user = await AppDataSource.getRepository(User).findOneOrFail({
        where: { id: resource.id },
      });
      const scoped = await authSessionService.createSession(
        user,
        {},
        AppDataSource.manager,
        null,
        ORG_A,
      );
      const plain = await authSessionService.createSession(user, {}, AppDataSource.manager);
      const key = await apiKeyFor(user, ORG_A);
      const bystander = await createUser(`stays@${DOMAIN}`, [[ORG_A, "member"]]);
      const bystanderKey = await apiKeyFor(bystander, ORG_A);
      const bystanderSession = await authSessionService.createSession(
        bystander,
        {},
        AppDataSource.manager,
        null,
        ORG_A,
      );

      const res = await scim("DELETE", `/Users/${user.id}`);
      expect(res.status).toBe(204);

      const after = await AppDataSource.getRepository(User).findOneOrFail({
        where: { id: user.id },
      });
      expect(after.isActive).toBe(false);
      expect(
        await AppDataSource.getRepository(UserOrganization).count({ where: { userId: user.id } }),
      ).toBe(0);
      const sessions = await AppDataSource.getRepository(Session).find({
        where: { userId: user.id },
      });
      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.revokedAt && s.revokedReason === "deprovisioned")).toBe(true);
      await expect(authSessionService.refresh(scoped.refreshToken)).rejects.toBeInstanceOf(
        RefreshRejectedError,
      );
      await expect(authSessionService.refresh(plain.refreshToken)).rejects.toBeInstanceOf(
        RefreshRejectedError,
      );
      expect(
        (await AppDataSource.getRepository(ApiKey).findOneOrFail({ where: { id: key.id } }))
          .isActive,
      ).toBe(false);
      expect(
        (
          await AppDataSource.getRepository(ApiKey).findOneOrFail({
            where: { id: bystanderKey.id },
          })
        ).isActive,
      ).toBe(true);
      await expect(authSessionService.refresh(bystanderSession.refreshToken)).resolves.toBeTruthy();
      expect((await scim("GET", `/Users/${user.id}`)).status).toBe(404);
      const [audit] = await auditRows("scim.user.delete");
      expect(audit.changes).toMatchObject({ accountDeactivated: true, apiTokensRevoked: 1 });
    });

    it("for a person in two organizations removes only this membership and leaves the other alone", async () => {
      const user = await createUser(`both@${DOMAIN}`, [
        [ORG_A, "member"],
        [ORG_B, "member"],
      ]);
      const scopedA = await authSessionService.createSession(
        user,
        {},
        AppDataSource.manager,
        null,
        ORG_A,
      );
      const scopedB = await authSessionService.createSession(
        user,
        {},
        AppDataSource.manager,
        null,
        ORG_B,
      );
      const plain = await authSessionService.createSession(user, {}, AppDataSource.manager);
      const keyA = await apiKeyFor(user, ORG_A);
      const keyB = await apiKeyFor(user, ORG_B);

      const res = await scim<UserResource>("PATCH", `/Users/${user.id}`, {
        body: patch([{ op: "replace", value: { active: false } }]),
      });
      expect(res.body.active).toBe(false);

      const account = await AppDataSource.getRepository(User).findOneOrFail({
        where: { id: user.id },
      });
      expect(account.isActive).toBe(true);
      const memberships = await AppDataSource.getRepository(UserOrganization).find({
        where: { userId: user.id },
      });
      expect(Object.fromEntries(memberships.map((m) => [m.organizationId, m.isActive]))).toEqual({
        [ORG_A]: false,
        [ORG_B]: true,
      });
      await expect(authSessionService.refresh(scopedA.refreshToken)).rejects.toBeInstanceOf(
        RefreshRejectedError,
      );
      await expect(authSessionService.refresh(scopedB.refreshToken)).resolves.toBeTruthy();
      await expect(authSessionService.refresh(plain.refreshToken)).resolves.toBeTruthy();
      const keys = await AppDataSource.getRepository(ApiKey).find({
        where: { createdByUserId: user.id },
      });
      expect(Object.fromEntries(keys.map((k) => [k.organizationId, k.isActive]))).toEqual({
        [ORG_A]: false,
        [ORG_B]: true,
      });
      expect(keys.map((k) => k.id)).toEqual(expect.arrayContaining([keyA.id, keyB.id]));
      // The other organization's view of the person is untouched.
      expect(
        (await scim<UserResource>("GET", `/Users/${user.id}`, { token: tokenB })).body.active,
      ).toBe(true);
    });

    it("closes the person's open dashboard sockets, in this organization or in all of them", async () => {
      const solo = await provision("soloist");
      const dual = await createUser(`dual2@${DOMAIN}`, [
        [ORG_A, "member"],
        [ORG_B, "member"],
      ]);
      const closed: string[] = [];
      const internals = websocketService as unknown as {
        clients: Map<string, unknown>;
        organizationClients: Map<string, Set<string>>;
      };
      const addSocket = (id: string, userId: string, organizationId: string) =>
        internals.clients.set(id, {
          ws: { close: () => closed.push(id), send: () => undefined },
          organizationId,
          authenticated: true,
          dashboardIdentity: { userId, email: "x", tokenVersion: 0 },
          ip: "203.0.113.9",
          ready: Promise.resolve(),
          authAttempted: true,
          isAlive: true,
        });
      addSocket("solo-a", solo.id, ORG_A);
      addSocket("dual-a", dual.id, ORG_A);
      addSocket("dual-b", dual.id, ORG_B);
      try {
        await scim("DELETE", `/Users/${solo.id}`);
        expect(closed).toEqual(["solo-a"]);
        await scim("PATCH", `/Users/${dual.id}`, {
          body: patch([{ op: "replace", value: { active: false } }]),
        });
        expect(closed.sort()).toEqual(["dual-a", "solo-a"]);
      } finally {
        for (const id of ["solo-a", "dual-a", "dual-b"]) internals.clients.delete(id);
      }
    });

    it("leaves no way back in: tickets, refresh and password sign-in are refused", async () => {
      const resource = await provision("gone");
      const user = await AppDataSource.getRepository(User).findOneOrFail({
        where: { id: resource.id },
      });
      await AppDataSource.getRepository(SsoConnection).save(
        AppDataSource.getRepository(SsoConnection).create({
          organizationId: ORG_A,
          protocol: "saml",
          issuer: "i",
          samlEntryPoint: "https://idp.example/sso",
          samlCertificate: "x",
          defaultRole: "member",
          roleMapping: {},
          enabled: true,
        }),
      );
      const ticket = "ticket-for-gone";
      mockRedis.values.set(
        `sso:ticket:${require("crypto").createHash("sha256").update(ticket).digest("hex")}`,
        JSON.stringify({ userId: user.id, organizationId: ORG_A }),
      );
      await scim("PATCH", `/Users/${user.id}`, {
        body: patch([{ op: "replace", value: { active: false } }]),
      });
      await expect(ssoService.redeemTicket(ticket)).rejects.toBeInstanceOf(SsoLoginError);
      const account = await AppDataSource.getRepository(User).findOneOrFail({
        where: { id: user.id },
      });
      expect(account.isActive).toBe(false);
    });

    it("leaves no credential that still reaches this organization: access token, API key, socket, auth code, refresh", async () => {
      const user = await createUser(`creds@${DOMAIN}`, [
        [ORG_A, "member"],
        [ORG_B, "member"],
      ]);
      const plain = await authSessionService.createSession(user, {}, AppDataSource.manager);
      const scopedA = await authSessionService.createSession(
        user,
        {},
        AppDataSource.manager,
        null,
        ORG_A,
      );
      const keyText = "hay_scim_test_key_not_a_secret";
      await AppDataSource.getRepository(ApiKey).save(
        AppDataSource.getRepository(ApiKey).create({
          organizationId: ORG_A,
          name: "mine",
          keyHash: await hashApiKey(keyText),
          scopes: [],
          isActive: true,
          createdByUserId: user.id,
        }),
      );
      const membershipA = await AppDataSource.getRepository(UserOrganization).findOneOrFail({
        where: { userId: user.id, organizationId: ORG_A },
        relations: ["organization"],
      });
      const { code } = await authRouter
        .createCaller({
          user: new AuthUser(user, "jwt", {
            sessionId: "s",
            ssoOrganizationId: ORG_A,
            organizationId: ORG_A,
            userOrganization: membershipA,
          }),
          organizationId: ORG_A,
          req: { headers: {} },
          res: {},
          ipAddress: "203.0.113.9",
          userAgent: "jest",
        } as unknown as Context)
        .generateAuthCode({ redirectUri: "https://billing.example.test/back" });
      const socketService = new WebSocketService();
      const socketInternals = socketService as unknown as {
        clients: Map<string, unknown>;
        authenticateClient(id: string, token: string): Promise<void>;
      };
      const open = {
        ws: { close: () => undefined, send: () => undefined },
        organizationId: ORG_A,
        authenticated: false,
        ip: "203.0.113.9",
        ready: Promise.resolve(),
        authAttempted: false,
        isAlive: true,
      };
      socketInternals.clients.set("c1", open);
      await socketInternals.authenticateClient("c1", plain.accessToken);
      expect(open.authenticated).toBe(true);
      const asRequest = (authorization: string, organizationId: string) =>
        ({ headers: { authorization, "x-organization-id": organizationId } }) as unknown as Request;

      await scim("PATCH", `/Users/${user.id}`, {
        body: patch([{ op: "replace", value: { active: false } }]),
      });

      // An access token issued earlier no longer opens this organization, and still opens the other.
      await expect(
        authenticate(asRequest(`Bearer ${plain.accessToken}`, ORG_A)),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        authenticate(asRequest(`Bearer ${plain.accessToken}`, ORG_B)),
      ).resolves.toBeTruthy();
      await expect(
        authenticate(asRequest(`Bearer ${scopedA.accessToken}`, ORG_A)),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      // The API key the person made is gone.
      await expect(authenticate(asRequest(`ApiKey ${keyText}`, ORG_A))).rejects.toThrow();
      // A new socket with the old token is refused for this organization.
      const fresh = { ...open, authenticated: false, authAttempted: false };
      socketInternals.clients.set("c2", fresh);
      await socketInternals.authenticateClient("c2", plain.accessToken);
      expect(fresh.authenticated).toBe(false);
      // A code issued while scoped to this organization buys nothing.
      await expect(
        authRouter
          .createCaller({
            user: null,
            organizationId: null,
            req: { headers: {} },
            res: {},
            ipAddress: "203.0.113.9",
            userAgent: "jest",
          } as unknown as Context)
          .exchangeAuthCode({
            code,
            redirectUri: "https://billing.example.test/back",
          }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      // The session limited to this organization cannot refresh; the shared one still can.
      await expect(authSessionService.refresh(scopedA.refreshToken)).rejects.toBeInstanceOf(
        RefreshRejectedError,
      );
      await expect(authSessionService.refresh(plain.refreshToken)).resolves.toBeTruthy();
    });

    it("lets the same person be switched back on, and brought back after a delete", async () => {
      const resource = await provision("boomerang", { externalId: "b-1" });
      await scim("PATCH", `/Users/${resource.id}`, {
        body: patch([{ op: "replace", value: { active: false } }]),
      });
      const back = await scim<UserResource>("PATCH", `/Users/${resource.id}`, {
        body: patch([{ op: "replace", value: { active: true } }]),
      });
      expect(back.body.active).toBe(true);
      expect(
        (await AppDataSource.getRepository(User).findOneOrFail({ where: { id: resource.id } }))
          .isActive,
      ).toBe(true);

      await scim("DELETE", `/Users/${resource.id}`);
      const again = await scim<UserResource>("POST", "/Users", {
        body: { userName: `boomerang@${DOMAIN}`, externalId: "b-2" },
      });
      expect(again.status).toBe(201);
      expect(again.body).toMatchObject({ id: resource.id, active: true, externalId: "b-2" });
    });
  });

  describe("groups", () => {
    async function mapRoles() {
      await AppDataSource.getRepository(SsoConnection).save(
        AppDataSource.getRepository(SsoConnection).create({
          organizationId: ORG_A,
          protocol: "saml",
          issuer: "https://idp.example/metadata",
          samlEntryPoint: "https://idp.example/sso",
          samlCertificate: "x",
          defaultRole: "viewer",
          roleClaim: "groups",
          roleMapping: { Admins: "admin", Support: "agent", Bosses: "owner" as never },
          enabled: false,
        }),
      );
    }
    const roleOf = async (id: string) =>
      (
        await AppDataSource.getRepository(UserOrganization).findOneOrFail({
          where: { userId: id, organizationId: ORG_A },
        })
      ).role;

    type GroupResource = {
      id: string;
      displayName: string;
      members: Array<{ value: string }>;
      meta: { location: string };
    };

    it("are created with members, read, filtered, listed and deleted", async () => {
      const a = await provision("ga");
      const created = await scim<GroupResource>("POST", "/Groups", {
        body: { displayName: "Staff", externalId: "g-1", members: [{ value: a.id }] },
      });
      expect(created.status).toBe(201);
      expect(created.body.members.map((m) => m.value)).toEqual([a.id]);
      expect(created.headers.get("location")).toBe(created.body.meta.location);
      const user = await scim<UserResource>("GET", `/Users/${a.id}`);
      expect(user.body.groups?.map((g) => g.display)).toEqual(["Staff"]);

      const filtered = await scim<{ totalResults: number }>(
        "GET",
        `/Groups?filter=${encodeURIComponent('displayName eq "staff"')}`,
      );
      expect(filtered.body.totalResults).toBe(1);
      expect((await scim<{ totalResults: number }>("GET", "/Groups")).body.totalResults).toBe(1);
      expect((await scim("POST", "/Groups", { body: { displayName: "Staff" } })).status).toBe(409);
      expect((await scim("DELETE", `/Groups/${created.body.id}`)).status).toBe(204);
      expect((await scim("GET", `/Groups/${created.body.id}`)).status).toBe(404);
    });

    it("give members the role their name maps to, through the sign-in mapping", async () => {
      await mapRoles();
      const a = await provision("ra");
      const b = await provision("rb");
      const group = await scim<GroupResource>("POST", "/Groups", {
        body: { displayName: "Support", members: [{ value: a.id }, { value: b.id }] },
      });
      expect(await roleOf(a.id)).toBe("agent");
      const admins = await scim<GroupResource>("POST", "/Groups", {
        body: { displayName: "Admins", members: [{ value: a.id }] },
      });
      expect(await roleOf(a.id)).toBe("admin");
      expect(await roleOf(b.id)).toBe("agent");

      // Entra removes a member with a filter; Okta adds with a list.
      await scim("PATCH", `/Groups/${admins.body.id}`, {
        body: patch([{ op: "remove", path: `members[value eq "${a.id}"]` }]),
      });
      expect(await roleOf(a.id)).toBe("agent");
      await scim("PATCH", `/Groups/${group.body.id}`, {
        body: patch([{ op: "remove", path: "members", value: [{ value: a.id }] }]),
      });
      expect(await roleOf(a.id)).toBe("viewer");
      await scim("PATCH", `/Groups/${admins.body.id}`, {
        body: patch([{ op: "add", path: "members", value: [{ value: a.id }] }]),
      });
      expect(await roleOf(a.id)).toBe("admin");
      await scim("DELETE", `/Groups/${admins.body.id}`);
      expect(await roleOf(a.id)).toBe("viewer");
      const roleChanges = await AppDataSource.getRepository(AuditLog).count({
        where: { action: "scim.role.change" },
      });
      expect(roleChanges).toBeGreaterThanOrEqual(5);
    });

    it("rename and replace move people to the roles of the new name", async () => {
      await mapRoles();
      const a = await provision("na");
      const b = await provision("nb");
      const group = await scim<GroupResource>("POST", "/Groups", {
        body: { displayName: "Team", members: [{ value: a.id }] },
      });
      expect(await roleOf(a.id)).toBe("viewer");
      await scim("PATCH", `/Groups/${group.body.id}`, {
        body: patch([{ op: "replace", path: "displayName", value: "Admins" }]),
      });
      expect(await roleOf(a.id)).toBe("admin");
      await scim("PUT", `/Groups/${group.body.id}`, {
        body: { displayName: "Admins", members: [{ value: b.id }] },
      });
      expect(await roleOf(a.id)).toBe("viewer");
      expect(await roleOf(b.id)).toBe("admin");
    });

    it("never make an owner, even when the mapping says so, and never change one", async () => {
      await mapRoles();
      const a = await provision("oa");
      await scim("POST", "/Groups", {
        body: { displayName: "Bosses", members: [{ value: a.id }, { value: ownerA.id }] },
      });
      expect(await roleOf(a.id)).toBe("viewer");
      expect(await roleOf(ownerA.id)).toBe("owner");
      await scim("POST", "/Groups", {
        body: { displayName: "Support", members: [{ value: ownerA.id }] },
      });
      expect(await roleOf(ownerA.id)).toBe("owner");
      expect(roleForGroups({ x: "owner" as never }, ["x"])).toBeNull();
    });

    it("leave a hand-promoted person alone when they are pushed into an unrelated group", async () => {
      await mapRoles();
      const promoted = await createUser(`hand@${DOMAIN}`, [[ORG_A, "admin"]]);
      const group = await scim<GroupResource>("POST", "/Groups", {
        body: { displayName: "Everyone", members: [{ value: promoted.id }] },
      });
      expect(await roleOf(promoted.id)).toBe("admin");
      await scim("PATCH", `/Groups/${group.body.id}`, {
        body: patch([{ op: "remove", path: "members", value: [{ value: promoted.id }] }]),
      });
      await scim("DELETE", `/Groups/${group.body.id}`);
      expect(await roleOf(promoted.id)).toBe("admin");
    });

    it("leave roles alone when the connection maps no groups", async () => {
      const a = await provision("la");
      await scim("POST", "/Groups", {
        body: { displayName: "Admins", members: [{ value: a.id }] },
      });
      expect(await roleOf(a.id)).toBe("member");
    });

    it("accept only people of this organization as members, and stay inside it", async () => {
      const stranger = await createUser(`far@${DOMAIN_B}`, [[ORG_B, "member"]]);
      const res = await scim("POST", "/Groups", {
        body: { displayName: "Mixed", members: [{ value: stranger.id }] },
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ scimType: "invalidValue" });
      const mine = await scim<GroupResource>("POST", "/Groups", { body: { displayName: "Mine" } });
      const own = await scim<GroupResource>("POST", "/Groups", {
        body: { displayName: "Theirs" },
        token: tokenB,
      });
      expect((await scim("GET", `/Groups/${own.body.id}`)).status).toBe(404);
      expect((await scim("DELETE", `/Groups/${own.body.id}`)).status).toBe(404);
      expect(
        (
          await scim("PATCH", `/Groups/${own.body.id}`, {
            body: patch([{ op: "replace", path: "displayName", value: "Hijacked" }]),
          })
        ).status,
      ).toBe(404);
      expect(
        await AppDataSource.getRepository(ScimGroup).count({ where: { organizationId: ORG_B } }),
      ).toBe(1);
      expect((await scim("GET", `/Groups/${mine.body.id}`, { token: tokenB })).status).toBe(404);
    });
  });

  describe("review follow-ups", () => {
    const deactivate = (id: string) =>
      scim("PATCH", `/Users/${id}`, { body: patch([{ op: "replace", value: { active: false } }]) });

    it("reactivation turns the account on when the only other membership is suspended", async () => {
      const user = await createUser(`quiet@${DOMAIN}`, [
        [ORG_A, "member"],
        [ORG_B, "member"],
      ]);
      await AppDataSource.getRepository(UserOrganization).update(
        { userId: user.id, organizationId: ORG_B },
        { isActive: false },
      );
      await deactivate(user.id);
      expect(
        (await AppDataSource.getRepository(User).findOneOrFail({ where: { id: user.id } }))
          .isActive,
      ).toBe(false);
      const res = await scim<UserResource>("PATCH", `/Users/${user.id}`, {
        body: patch([{ op: "replace", value: { active: true } }]),
      });
      expect(res.body.active).toBe(true);
      expect(
        (await AppDataSource.getRepository(User).findOneOrFail({ where: { id: user.id } }))
          .isActive,
      ).toBe(true);
    });

    it("refuses a rename and a name change when another membership exists, suspended or not", async () => {
      const user = await createUser(`kept@${DOMAIN}`, [
        [ORG_A, "member"],
        [ORG_B, "member"],
      ]);
      await AppDataSource.getRepository(UserOrganization).update(
        { userId: user.id, organizationId: ORG_B },
        { isActive: false },
      );
      const renamed = await scim("PATCH", `/Users/${user.id}`, {
        body: patch([{ op: "replace", path: "userName", value: `renamed2@${DOMAIN}` }]),
      });
      expect(renamed.status).toBe(400);
      await scim("PATCH", `/Users/${user.id}`, {
        body: patch([{ op: "replace", value: { name: { givenName: "Changed" } } }]),
      });
      const after = await AppDataSource.getRepository(User).findOneOrFail({
        where: { id: user.id },
      });
      expect(after).toMatchObject({ email: `kept@${DOMAIN}`, firstName: "First" });
    });

    it("answers 401 for a suspended or deactivated organization, and for none after the connection is deleted", async () => {
      await AppDataSource.getRepository(Organization).update(
        { id: ORG_A },
        { suspendedAt: new Date() },
      );
      expect((await scim("GET", "/Users")).status).toBe(401);
      await AppDataSource.getRepository(Organization).update(
        { id: ORG_A },
        { suspendedAt: null, isActive: false },
      );
      expect((await scim("GET", "/Users")).status).toBe(401);
      await AppDataSource.getRepository(Organization).update({ id: ORG_A }, { isActive: true });
      expect((await scim("GET", "/Users")).status).toBe(200);
    });

    it("revokes the token when the connection is deleted, and works without a connection until then", async () => {
      // A token can exist before any connection: users then get the default role and groups map to nothing.
      expect((await scim("GET", "/Users")).status).toBe(200);
      await AppDataSource.getRepository(SsoConnection).save(
        AppDataSource.getRepository(SsoConnection).create({
          organizationId: ORG_A,
          protocol: "saml",
          issuer: "https://idp.example/metadata",
          samlEntryPoint: "https://idp.example/sso",
          samlCertificate: "x",
          defaultRole: "member",
          roleMapping: {},
          enabled: false,
        }),
      );
      await ssoService.deleteConnection(ORG_A, { userId: ownerA.id });
      expect((await scim("GET", "/Users")).status).toBe(401);
      expect(
        await AppDataSource.getRepository(ScimToken).count({ where: { organizationId: ORG_A } }),
      ).toBe(0);
    });

    it("answers a huge startIndex with an empty page, not an error", async () => {
      for (const index of ["1000000000000000000000", "99999999999999999"]) {
        const res = await scim<ListResource>("GET", `/Users?startIndex=${index}`);
        expect(res.status).toBe(200);
        expect(res.body.Resources).toEqual([]);
      }
    });
  });

  describe("request parsing", () => {
    it("reads both providers' shapes of the same change", () => {
      expect(parseUserPatch(patch([{ op: "replace", value: { active: false } }]))).toEqual({
        active: false,
      });
      expect(parseUserPatch(patch([{ op: "Replace", path: "active", value: "False" }]))).toEqual({
        active: false,
      });
      expect(
        parseUserPatch(
          patch([
            {
              op: "replace",
              path: "urn:ietf:params:scim:schemas:core:2.0:User:userName",
              value: "A@B.co",
            },
          ]),
        ),
      ).toEqual({ userName: "A@B.co" });
      expect(
        parseGroupPatch(
          patch([
            {
              op: "add",
              path: "members",
              value: [{ value: "6f0e4f5e-4d3b-4a39-9a2b-0f0e4f5e4d3b" }],
            },
          ]),
        ),
      ).toMatchObject({
        add: ["6f0e4f5e-4d3b-4a39-9a2b-0f0e4f5e4d3b"],
      });
    });
  });

  describe("sockets", () => {
    it("closeDashboardSockets leaves other people's sockets open", () => {
      const service = new WebSocketService();
      const internals = service as unknown as { clients: Map<string, unknown> };
      const closed: string[] = [];
      for (const [id, userId] of [
        ["a", "u1"],
        ["b", "u2"],
      ]) {
        internals.clients.set(id, {
          ws: { close: () => closed.push(id) },
          organizationId: ORG_A,
          authenticated: true,
          dashboardIdentity: { userId, email: "x" },
        });
      }
      expect(service.closeDashboardSockets("u1")).toBe(1);
      expect(closed).toEqual(["a"]);
    });
  });
});
