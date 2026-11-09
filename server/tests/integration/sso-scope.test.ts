/**
 * The one-organization limit on single sign-on sessions and the enforcement rule hold on the
 * dashboard WebSocket and across auth codes, and survive refresh.
 */
import "reflect-metadata";
import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from "@jest/globals";
import { In } from "typeorm";

const mockRedis = {
  connected: true,
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
    isConnected: () => mockRedis.connected,
    getClient: () => mockRedis.client,
    subscribe: async () => undefined,
  },
}));
jest.mock("../../services/rate-limit.service", () => ({
  rateLimitService: {
    checkIpRateLimit: async () => ({ limited: false }),
    checkEmailRateLimit: async () => ({ limited: false }),
    checkKeyRateLimit: async () => ({ limited: false }),
    resetRateLimit: async () => undefined,
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
import { UserMfa } from "../../database/entities/user-mfa.entity";
import { Organization } from "../../entities/organization.entity";
import { Session } from "../../entities/session.entity";
import { AuthCode } from "../../entities/auth-code.entity";
import { User } from "../../entities/user.entity";
import { UserOrganization } from "../../entities/user-organization.entity";
import { AuthUser } from "../../lib/auth/AuthUser";
import { hashPassword } from "../../lib/auth/utils/hashing";
import { verifyToken } from "../../lib/auth/utils/jwt";
import { authRouter } from "../../routes/v1/auth";
import { authSessionService } from "../../services/auth-session.service";
import { WebSocketService } from "../../services/websocket.service";
import type { Context } from "../../trpc/context";

const DOMAIN = "scope-sso.test";
const ORG_A = "5500e000-0000-4000-8000-0000000000d1";
const ORG_B = "5500e000-0000-4000-8000-0000000000d2";
const ORIGIN = "https://billing.example.test";

const ctxFor = (extra: Partial<Context> = {}): Context =>
  ({
    user: null,
    organizationId: null,
    req: { headers: {} },
    res: {},
    ipAddress: "203.0.113.9",
    userAgent: "jest",
    ...extra,
  }) as unknown as Context;

async function createUser(local: string, orgs: Array<[string, "owner" | "member"]>) {
  const users = AppDataSource.getRepository(User);
  const user = await users.save(
    users.create({
      email: `${local}@${DOMAIN}`,
      password: await hashPassword("CorrectHorse9!"),
      isActive: true,
      emailVerified: true,
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

async function tokenFor(user: User, ssoOrganizationId?: string) {
  const tokens = await authSessionService.createSession(
    user,
    {},
    AppDataSource.manager,
    null,
    ssoOrganizationId,
  );
  return tokens;
}

async function sessionCtx(
  user: User,
  ssoOrganizationId: string | undefined,
  organizationId: string,
) {
  const userOrganization = await AppDataSource.getRepository(UserOrganization).findOneOrFail({
    where: { userId: user.id, organizationId },
    relations: ["organization"],
  });
  return ctxFor({
    user: new AuthUser(user, "jwt", {
      sessionId: "s",
      ssoOrganizationId,
      organizationId,
      userOrganization,
    }),
    organizationId,
  });
}

type SocketInternals = {
  clients: Map<string, unknown>;
  organizationClients: Map<string, Set<string>>;
  authenticateClient(id: string, token: string): Promise<void>;
  revalidateDashboardClients(): Promise<void>;
};

function socketFixture(organizationId: string) {
  const service = new WebSocketService();
  const internals = service as unknown as SocketInternals;
  const closed: string[] = [];
  const client = {
    ws: { close: (_code: number, reason: string) => closed.push(reason), send: () => undefined },
    organizationId,
    authenticated: false,
    ip: "203.0.113.9",
    ready: Promise.resolve(),
    authAttempted: false,
    isAlive: true,
  };
  internals.clients.set("c1", client);
  return { internals, client, closed };
}

async function cleanup() {
  const users = await AppDataSource.getRepository(User)
    .createQueryBuilder("u")
    .where("u.email LIKE :d", { d: `%@${DOMAIN}` })
    .getMany();
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await AppDataSource.getRepository(Session).delete({ userId: In(ids) });
    await AppDataSource.getRepository(AuthCode).delete({ userId: In(ids) });
    await AppDataSource.getRepository(UserMfa).delete({ userId: In(ids) });
    await AppDataSource.getRepository(UserOrganization).delete({ userId: In(ids) });
    await AppDataSource.getRepository(User).delete({ id: In(ids) });
  }
  await AppDataSource.getRepository(Organization).delete({ id: In([ORG_A, ORG_B]) });
}

describe("single sign-on session scope", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    process.env.CONNECT_ALLOWED_REDIRECT_ORIGINS = ORIGIN;
  });

  beforeEach(async () => {
    mockRedis.connected = true;
    mockRedis.values.clear();
    await cleanup();
    const orgs = AppDataSource.getRepository(Organization);
    await orgs.save(orgs.create({ id: ORG_A, name: "A", slug: "scope-a" }));
    await orgs.save(orgs.create({ id: ORG_B, name: "B", slug: "scope-b" }));
  });

  afterAll(async () => {
    delete process.env.CONNECT_ALLOWED_REDIRECT_ORIGINS;
    await cleanup();
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  describe("dashboard WebSocket", () => {
    it("accepts a scoped token for its own organization and refuses another", async () => {
      const user = await createUser("both", [
        [ORG_A, "member"],
        [ORG_B, "member"],
      ]);
      const { accessToken } = await tokenFor(user, ORG_A);

      const own = socketFixture(ORG_A);
      await own.internals.authenticateClient("c1", accessToken);
      expect(own.client.authenticated).toBe(true);

      const other = socketFixture(ORG_B);
      await other.internals.authenticateClient("c1", accessToken);
      expect(other.client.authenticated).toBe(false);
    });

    it("refuses a password session for an organization that enforces SSO, but not the break-glass owner", async () => {
      const member = await createUser("member", [[ORG_A, "member"]]);
      const owner = await createUser("owner", [[ORG_A, "owner"]]);
      await AppDataSource.getRepository(UserMfa).save(
        AppDataSource.getRepository(UserMfa).create({
          userId: owner.id,
          secret: "enc:v3:placeholder",
          confirmedAt: new Date(),
          recoveryCodes: [],
        }),
      );
      await AppDataSource.getRepository(Organization).update(ORG_A, {
        settings: { ssoEnforced: true },
      });

      const memberSocket = socketFixture(ORG_A);
      await memberSocket.internals.authenticateClient("c1", (await tokenFor(member)).accessToken);
      expect(memberSocket.client.authenticated).toBe(false);

      const ownerSocket = socketFixture(ORG_A);
      await ownerSocket.internals.authenticateClient("c1", (await tokenFor(owner)).accessToken);
      expect(ownerSocket.client.authenticated).toBe(true);

      const ssoSocket = socketFixture(ORG_A);
      await ssoSocket.internals.authenticateClient(
        "c1",
        (await tokenFor(member, ORG_A)).accessToken,
      );
      expect(ssoSocket.client.authenticated).toBe(true);
    });

    it("closes an open socket when enforcement is turned on", async () => {
      const member = await createUser("later", [[ORG_A, "member"]]);
      const socket = socketFixture(ORG_A);
      await socket.internals.authenticateClient("c1", (await tokenFor(member)).accessToken);
      expect(socket.client.authenticated).toBe(true);

      await socket.internals.revalidateDashboardClients();
      expect(socket.closed).toEqual([]);

      await AppDataSource.getRepository(Organization).update(ORG_A, {
        settings: { ssoEnforced: true },
      });
      await socket.internals.revalidateDashboardClients();
      expect(socket.closed).toEqual(["Unauthorized"]);
      expect(socket.client.authenticated).toBe(false);
    });

    it("leaves sockets open when the lookup fails", async () => {
      const member = await createUser("flaky", [[ORG_A, "member"]]);
      const socket = socketFixture(ORG_A);
      await socket.internals.authenticateClient("c1", (await tokenFor(member)).accessToken);
      const spy = jest.spyOn(AppDataSource, "getRepository").mockImplementation(() => {
        throw new Error("database unavailable");
      });
      await expect(socket.internals.revalidateDashboardClients()).rejects.toThrow();
      spy.mockRestore();
      expect(socket.closed).toEqual([]);
    });
  });

  describe("auth codes", () => {
    const exchange = (code: string, redirectUri = `${ORIGIN}/back`) =>
      authRouter.createCaller(ctxFor()).exchangeAuthCode({ code, redirectUri });

    it("a code from a scoped session gives a scoped session that cannot be replayed", async () => {
      const user = await createUser("coder", [
        [ORG_A, "member"],
        [ORG_B, "member"],
      ]);
      const caller = authRouter.createCaller(await sessionCtx(user, ORG_A, ORG_A));
      const { code } = await caller.generateAuthCode({ redirectUri: `${ORIGIN}/back` });

      expect(
        await AppDataSource.getRepository(AuthCode).count({ where: { userId: user.id } }),
      ).toBe(0);

      const result = await exchange(code);
      expect(verifyToken<{ sso?: string }>(result.accessToken).sso).toBe(ORG_A);
      const session = await AppDataSource.getRepository(Session).findOneOrFail({
        where: { userId: user.id },
      });
      expect(session.metadata).toEqual({ ssoOrganizationId: ORG_A });

      await expect(exchange(code)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("the session from such a code is refused in the account's other organization", async () => {
      const user = await createUser("limited", [
        [ORG_A, "member"],
        [ORG_B, "member"],
      ]);
      const caller = authRouter.createCaller(await sessionCtx(user, ORG_A, ORG_A));
      const { code } = await caller.generateAuthCode({ redirectUri: `${ORIGIN}/back` });
      const result = await exchange(code);
      const { assertSsoPolicy } = await import("../../lib/auth/sso/policy");
      const membershipB = await AppDataSource.getRepository(UserOrganization).findOneOrFail({
        where: { userId: user.id, organizationId: ORG_B },
        relations: ["organization"],
      });
      await expect(
        assertSsoPolicy(
          { id: user.id, ssoOrganizationId: verifyToken<{ sso?: string }>(result.accessToken).sso },
          membershipB,
        ),
      ).rejects.toMatchObject({ cause: { type: "SSO_SESSION_SCOPE" } });
    });

    it("a connect code from a scoped session is scoped too", async () => {
      const user = await createUser("connect", [[ORG_A, "member"]]);
      const caller = authRouter.createCaller(await sessionCtx(user, ORG_A, ORG_A));
      const { redirectUrl } = await caller.generateConnectAuthCode({
        redirectUri: `${ORIGIN}/back`,
      });
      const code = new URL(redirectUrl).searchParams.get("code")!;
      const result = await exchange(code);
      expect(verifyToken<{ sso?: string }>(result.accessToken).sso).toBe(ORG_A);
    });

    it("refuses a scoped code from another origin", async () => {
      const user = await createUser("origin", [[ORG_A, "member"]]);
      const caller = authRouter.createCaller(await sessionCtx(user, ORG_A, ORG_A));
      const { code } = await caller.generateAuthCode({ redirectUri: `${ORIGIN}/back` });
      await expect(exchange(code, "https://evil.example/back")).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("cannot be issued or used without Redis", async () => {
      const user = await createUser("noredis", [[ORG_A, "member"]]);
      const caller = authRouter.createCaller(await sessionCtx(user, ORG_A, ORG_A));
      const { code } = await caller.generateAuthCode({ redirectUri: `${ORIGIN}/back` });
      mockRedis.connected = false;
      await expect(exchange(code)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        caller.generateAuthCode({ redirectUri: `${ORIGIN}/back` }),
      ).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
    });

    it("leaves unscoped codes as they were", async () => {
      const user = await createUser("plain", [[ORG_A, "member"]]);
      const caller = authRouter.createCaller(await sessionCtx(user, undefined, ORG_A));
      mockRedis.connected = false;
      const { code } = await caller.generateAuthCode({ redirectUri: `${ORIGIN}/back` });
      expect(
        await AppDataSource.getRepository(AuthCode).count({ where: { userId: user.id } }),
      ).toBe(1);
      const result = await exchange(code);
      expect(verifyToken<{ sso?: string }>(result.accessToken).sso).toBeUndefined();
      await expect(exchange(code)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("refresh", () => {
    it("keeps the scope when the token is rotated", async () => {
      const user = await createUser("rotate", [[ORG_A, "member"]]);
      const tokens = await tokenFor(user, ORG_A);
      const next = await authSessionService.refresh(tokens.refreshToken);
      expect(verifyToken<{ sso?: string }>(next.accessToken).sso).toBe(ORG_A);
    });
  });
});
