/**
 * Per-organization SAML sign-in: the happy path, and each way a response is
 * refused. The provider signs real XML with real keys (tests/helpers/fake-saml-idp.ts);
 * no signature check is stubbed.
 */
process.env.API_DOMAIN = "api.hay-saml.test";
process.env.DASHBOARD_DOMAIN = "app.hay-saml.test";

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
import type { AddressInfo } from "net";
import type { Server } from "http";
import express from "express";
import type Redis from "ioredis";
import { In } from "typeorm";

/** The few Redis commands the sign-in uses, with expiry ignored. */
class MockRedis {
  values = new Map<string, string>();
  async set(key: string, value: string, ...args: Array<string | number>) {
    if (args.includes("NX") && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async getdel(key: string) {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
}
const mockRedis = new MockRedis();

jest.mock("../../services/redis.service", () => ({
  redisService: { isConnected: () => true, getClient: () => mockRedis },
}));
jest.mock("../../services/rate-limit.service", () => ({
  rateLimitService: { checkIpRateLimit: async () => ({ limited: false }) },
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
import { SsoIdentity } from "../../database/entities/sso-identity.entity";
import { UserMfa } from "../../database/entities/user-mfa.entity";
import { AuditLog } from "../../entities/audit-log.entity";
import { Organization } from "../../entities/organization.entity";
import { Session } from "../../entities/session.entity";
import { User } from "../../entities/user.entity";
import { UserOrganization } from "../../entities/user-organization.entity";
import { bodyLimitForPath } from "../../lib/body-limits";
import { hashPassword } from "../../lib/auth/utils/hashing";
import { verifyToken } from "../../lib/auth/utils/jwt";
import {
  RedisSamlCache,
  validateSamlResponse,
  type SamlConnectionConfig,
} from "../../lib/auth/sso/saml";
import { authRouter } from "../../routes/v1/auth";
import ssoRoutes from "../../routes/sso";
import {
  SSO_BINDING_COOKIE,
  SsoLoginError,
  ssoService,
  type SamlConnectionInput,
} from "../../services/sso.service";
import type { Context } from "../../trpc/context";
import { FakeSamlIdp, type FakeResponseOptions } from "../helpers/fake-saml-idp";

const DOMAIN = "acme-saml.test";
const OTHER_DOMAIN = "other-saml.test";
const ORG_ID = "5a3100e0-0000-4000-8000-0000000000a1";
const OTHER_ORG_ID = "5a3100e0-0000-4000-8000-0000000000b2";

const idp = new FakeSamlIdp();
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

async function createUser(
  email: string,
  organizationId: string | null,
  role: "owner" | "member" = "member",
): Promise<User> {
  const users = AppDataSource.getRepository(User);
  const user = await users.save(
    users.create({
      email,
      password: await hashPassword("CorrectHorse9!"),
      isActive: true,
      emailVerified: true,
    }),
  );
  if (organizationId) {
    const memberships = AppDataSource.getRepository(UserOrganization);
    await memberships.save(
      memberships.create({ userId: user.id, organizationId, role, isActive: true }),
    );
  }
  return user;
}

async function verifiedDomain(organizationId: string, domain: string) {
  const row = await ssoService.addDomain(organizationId, domain, actor);
  const spy = jest.spyOn(dns, "resolveTxt").mockImplementation((async (name: string) => {
    if (name !== `_hay-sso-challenge.${domain}`) throw new Error("ENOTFOUND");
    return [[`hay-sso-verification=${row.verificationToken}`]];
  }) as unknown as typeof dns.resolveTxt);
  await ssoService.verifyDomain(organizationId, row.id, actor);
  spy.mockRestore();
}

async function configureSaml(overrides: Partial<SamlConnectionInput> = {}) {
  await ssoService.saveConnection(
    ORG_ID,
    {
      protocol: "saml",
      idpEntityId: idp.entityId,
      ssoUrl: idp.ssoUrl,
      certificate: idp.certificate,
      defaultRole: "member",
      roleClaim: null,
      roleMapping: {},
      enabled: true,
      ...overrides,
    },
    actor,
  );
}

/** The browser starts a sign-in; the provider reads the request. */
async function start(email: string) {
  const { url, binding } = await ssoService.beginLogin(email);
  return { binding, request: idp.decodeRedirect(url) };
}

/** A whole sign-in up to the one-minute ticket. */
async function signIn(
  email: string,
  options: FakeResponseOptions = {},
  overrides: { binding?: string } = {},
) {
  const { binding, request } = await start(email);
  const samlResponse = idp.respond(request, { nameId: email, ...options });
  const handle = await ssoService.handleSamlResponse({
    samlResponse,
    relayState: request.relayState,
  });
  return ssoService.finishSamlLogin({ handle, binding: overrides.binding ?? binding });
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

async function expectNoAccount(email: string) {
  expect(await AppDataSource.getRepository(User).count({ where: { email } })).toBe(0);
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

describe("single sign-on (SAML)", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
  });

  beforeEach(async () => {
    mockRedis.values.clear();
    await cleanup();
    const orgs = AppDataSource.getRepository(Organization);
    await orgs.save(orgs.create({ id: ORG_ID, name: "Acme", slug: "acme-saml" }));
    await orgs.save(orgs.create({ id: OTHER_ORG_ID, name: "Other", slug: "other-saml" }));
    actor.userId = (await createUser(`admin@${OTHER_DOMAIN}`, OTHER_ORG_ID, "owner")).id;
    await verifiedDomain(ORG_ID, DOMAIN);
    await configureSaml();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await cleanup();
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  describe("a sign-in", () => {
    it("signs a new person in through a signed assertion and scopes the session to the organization", async () => {
      const email = `new@${DOMAIN}`;
      const ticket = await signIn(email, {
        attributes: { email: [email], givenName: ["Nia"], sn: ["Lopez"] },
      });
      const result = await authRouter.createCaller(publicCtx()).sso.exchange({ ticket });

      expect(result.mfaRequired).toBe(false);
      if (result.mfaRequired) throw new Error("unexpected challenge");
      expect(verifyToken<{ sso?: string }>(result.accessToken).sso).toBe(ORG_ID);

      const user = await AppDataSource.getRepository(User).findOneOrFail({ where: { email } });
      expect(user.firstName).toBe("Nia");
      expect(user.lastName).toBe("Lopez");
      const membership = await AppDataSource.getRepository(UserOrganization).findOneOrFail({
        where: { userId: user.id, organizationId: ORG_ID },
      });
      expect(membership.role).toBe("member");
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

    it("sends the request to the provider with an id, the ACS URL and this organization's entity id", async () => {
      const { request } = await start(`someone@${DOMAIN}`);
      expect(request.id).toMatch(/^_[0-9a-f]{40}$/);
      expect(request.acsUrl).toMatch(/\/sso\/saml\/acs$/);
      expect(request.issuer).toMatch(new RegExp(`/sso/saml/${ORG_ID}$`));
      expect(request.relayState.length).toBeGreaterThan(30);
      expect(request.relayState.length).toBeLessThan(80);
    });

    it("takes the email from the NameID when no attribute carries it", async () => {
      const email = `nameid@${DOMAIN}`;
      const ticket = await signIn(email, {
        nameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        attributes: {},
      });
      const { user } = await ssoService.redeemTicket(ticket);
      expect(user.email).toBe(email);
    });

    it("matches a returning person by NameID, not by email", async () => {
      await signIn(`first@${DOMAIN}`, {
        nameId: "opaque-1",
        attributes: { email: [`first@${DOMAIN}`] },
      });
      const { binding, request } = await start(`first@${DOMAIN}`);
      const handle = await ssoService.handleSamlResponse({
        samlResponse: idp.respond(request, {
          nameId: "opaque-1",
          attributes: { email: [`renamed@${DOMAIN}`] },
        }),
        relayState: request.relayState,
      });
      const { user } = await ssoService.redeemTicket(
        await ssoService.finishSamlLogin({ handle, binding }),
      );
      expect(user.email).toBe(`first@${DOMAIN}`);
      await expectNoAccount(`renamed@${DOMAIN}`);
    });

    it("maps an assertion attribute to a role and never to owner", async () => {
      await configureSaml({
        roleClaim: "groups",
        roleMapping: { admins: "admin", staff: "agent" },
      });
      const email = `mapped@${DOMAIN}`;
      await signIn(email, { attributes: { email: [email], groups: ["staff", "admins"] } });
      const user = await AppDataSource.getRepository(User).findOneOrFail({ where: { email } });
      const membership = await AppDataSource.getRepository(UserOrganization).findOneOrFail({
        where: { userId: user.id, organizationId: ORG_ID },
      });
      expect(membership.role).toBe("admin");
    });

    it("spends the ticket once", async () => {
      const ticket = await signIn(`once@${DOMAIN}`);
      await authRouter.createCaller(publicCtx()).sso.exchange({ ticket });
      await expect(
        authRouter.createCaller(publicCtx()).sso.exchange({ ticket }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("serves service provider metadata for the organization", async () => {
      const xml = await ssoService.samlMetadata(ORG_ID);
      expect(xml).toContain("EntityDescriptor");
      expect(xml).toContain(`/sso/saml/${ORG_ID}`);
      expect(xml).toContain("/sso/saml/acs");
      expect(await ssoService.samlMetadata(OTHER_ORG_ID)).toBeNull();
    });
  });

  describe("responses that are refused", () => {
    const email = `person@${DOMAIN}`;

    async function refused(options: FakeResponseOptions, expected = "token_invalid") {
      expect(await failureOf(signIn(email, options))).toBe(expected);
      await expectNoAccount(email);
    }

    it("an unsigned response", async () => refused({ signing: "none" }));

    it("a response signed at the top while the assertion is not", async () =>
      refused({ signing: "response" }));

    it("an assertion signed with a key that is not the configured certificate", async () =>
      refused({ signing: "other-key" }));

    it("an assertion changed after it was signed", async () =>
      refused({
        nameId: `victim@${DOMAIN}`,
        attributes: { email: [`victim@${DOMAIN}`] },
        tamper: (xml) => xml.split(`victim@${DOMAIN}`).join(`attacker@${DOMAIN}`),
      }));

    it("a forged assertion placed before the signed one", async () => {
      const { binding, request } = await start(email);
      const samlResponse = idp.respond(request, {
        nameId: email,
        assemble: ({ assertion, responseOpen, header }) =>
          `${responseOpen}${header}${idp.forgedAssertion(request, `ceo@${DOMAIN}`)}${assertion}</samlp:Response>`,
      });
      expect(
        await failureOf(
          ssoService.handleSamlResponse({ samlResponse, relayState: request.relayState }),
        ),
      ).toBe("token_invalid");
      expect(binding).toBeTruthy();
      await expectNoAccount(`ceo@${DOMAIN}`);
    });

    it("a signed assertion hidden inside an unsigned one", async () => {
      const { request } = await start(email);
      const samlResponse = idp.respond(request, {
        nameId: email,
        assemble: ({ assertion, responseOpen, header }) => {
          const forged = idp
            .forgedAssertion(request, `ceo@${DOMAIN}`)
            .replace(
              "</saml:Assertion>",
              `<saml:Advice>${assertion}</saml:Advice></saml:Assertion>`,
            );
          return `${responseOpen}${header}${forged}</samlp:Response>`;
        },
      });
      expect(
        await failureOf(
          ssoService.handleSamlResponse({ samlResponse, relayState: request.relayState }),
        ),
      ).toBe("token_invalid");
      await expectNoAccount(`ceo@${DOMAIN}`);
    });

    it("a signed assertion moved under another element of the response", async () => {
      const { request } = await start(email);
      const samlResponse = idp.respond(request, {
        nameId: email,
        assemble: ({ assertion, responseOpen, header }) =>
          `${responseOpen}${header}<samlp:Extensions>${assertion}</samlp:Extensions>${idp.forgedAssertion(request, `ceo@${DOMAIN}`)}</samlp:Response>`,
      });
      expect(
        await failureOf(
          ssoService.handleSamlResponse({ samlResponse, relayState: request.relayState }),
        ),
      ).toBe("token_invalid");
      await expectNoAccount(`ceo@${DOMAIN}`);
    });

    it("a comment inside a signed NameID cannot cut the name short", async () => {
      // The provider itself signed `admin@acme-saml.test<!---->.evil.test`. Only the whole
      // signed text counts as the name, so it is never read as the administrator's address.
      const target = `admin@${DOMAIN}`;
      expect(
        await failureOf(
          signIn(target, { nameId: target, nameIdMarkup: "<!---->.evil.test", attributes: {} }),
        ),
      ).toBe("domain_unverified");
      await expectNoAccount(target);
      await expectNoAccount(`${target}.evil.test`);
    });

    it("an assertion meant for another audience", async () =>
      refused({ audience: "https://other-sp.example/entity" }));

    it("an assertion addressed to another endpoint", async () =>
      refused({ recipient: "https://evil.example/sso/saml/acs" }));

    it("an assertion with no bearer confirmation", async () => refused({ noConfirmation: true }));

    it("an assertion that has expired", async () => refused({ notOnOrAfterOffset: -600 }));

    it("an assertion that is not valid yet", async () => refused({ notBeforeOffset: 600 }));

    it("an assertion from another issuer", async () =>
      refused({ issuer: "https://evil.example/metadata" }));

    it("a response that answers a different request", async () =>
      refused({ inResponseTo: "_somebody-elses-request" }));

    it("a response that answers no request", async () => refused({ inResponseTo: null }));

    it("a transient NameID, which could not identify a returning person", async () =>
      refused({ nameIdFormat: "urn:oasis:names:tc:SAML:2.0:nameid-format:transient" }));

    it("an assertion with no email address anywhere in the signed part", async () => {
      const { request } = await start(email);
      const samlResponse = idp.respond(request, {
        nameId: "opaque-id",
        attributes: {},
        // An address placed outside the signed assertion must not be read.
        assemble: ({ assertion, responseOpen, header }) =>
          `${responseOpen}${header}<samlp:Extensions><email>${email}</email></samlp:Extensions>${assertion}</samlp:Response>`,
      });
      expect(
        await failureOf(
          ssoService.handleSamlResponse({ samlResponse, relayState: request.relayState }),
        ),
      ).toBe("token_invalid");
      await expectNoAccount(email);
    });

    it("an address on a domain the organization has not proven", async () => {
      const outsider = `person@${OTHER_DOMAIN}`;
      // The sign-in starts for an address the organization owns; the assertion names another.
      expect(
        await failureOf(
          signIn(`starter@${DOMAIN}`, { nameId: outsider, attributes: { email: [outsider] } }),
        ),
      ).toBe("domain_unverified");
      await expectNoAccount(outsider);
    });

    it("an address that belongs to an account outside the organization", async () => {
      await createUser(`elsewhere@${DOMAIN}`, OTHER_ORG_ID);
      expect(await failureOf(signIn(`elsewhere@${DOMAIN}`))).toBe("account_conflict");
    });

    it("a response nobody asked for: no relay state, or one that was never issued", async () => {
      const { request } = await start(email);
      const samlResponse = idp.respond(request, { nameId: email });
      expect(
        await failureOf(
          ssoService.handleSamlResponse({ samlResponse, relayState: "never-issued" }),
        ),
      ).toBe("state_invalid");
      expect(
        await failureOf(ssoService.handleSamlResponse({ samlResponse, relayState: "x" })),
      ).toBe("state_invalid");
    });

    it("a state that belongs to an OpenID Connect sign-in", async () => {
      mockRedis.values.set(
        `sso:state:${require("crypto").createHash("sha256").update("oidc-state").digest("hex")}`,
        JSON.stringify({
          protocol: "oidc",
          connectionId: "x",
          organizationId: ORG_ID,
          issuer: "x",
          bindingHash: "x",
        }),
      );
      const { request } = await start(email);
      expect(
        await failureOf(
          ssoService.handleSamlResponse({
            samlResponse: idp.respond(request, { nameId: email }),
            relayState: "oidc-state",
          }),
        ),
      ).toBe("state_invalid");
    });

    it("a replay of a response that already signed someone in", async () => {
      const { binding, request } = await start(email);
      const samlResponse = idp.respond(request, { nameId: email });
      const handle = await ssoService.handleSamlResponse({
        samlResponse,
        relayState: request.relayState,
      });
      await ssoService.finishSamlLogin({ handle, binding });
      expect(
        await failureOf(
          ssoService.handleSamlResponse({ samlResponse, relayState: request.relayState }),
        ),
      ).toBe("state_invalid");
      // A fresh sign-in cannot take the old response either: it answers the old request.
      const second = await start(email);
      expect(
        await failureOf(
          ssoService.handleSamlResponse({ samlResponse, relayState: second.request.relayState }),
        ),
      ).toBe("token_invalid");
    });

    it("an assertion presented twice even when its request is somehow still open", async () => {
      const connection = await AppDataSource.getRepository(SsoConnection).findOneOrFail({
        where: { organizationId: ORG_ID },
      });
      const config: SamlConnectionConfig = {
        organizationId: ORG_ID,
        connectionId: connection.id,
        idpEntityId: idp.entityId,
        entryPoint: idp.ssoUrl,
        certificate: connection.samlCertificate as string,
      };
      const cache = new RedisSamlCache(mockRedis as unknown as Redis, connection.id);
      const { request } = await start(email);
      const samlResponse = idp.respond(request, { nameId: email });
      const input = { samlResponse, requestId: request.id };

      await cache.saveAsync(request.id, new Date().toISOString());
      await expect(validateSamlResponse(config, cache, input)).resolves.toMatchObject({
        email,
      });
      await cache.saveAsync(request.id, new Date().toISOString());
      await expect(validateSamlResponse(config, cache, input)).rejects.toThrow(
        /already been received/,
      );
    });

    it("a second use of the handle", async () => {
      const { binding, request } = await start(email);
      const handle = await ssoService.handleSamlResponse({
        samlResponse: idp.respond(request, { nameId: email }),
        relayState: request.relayState,
      });
      await ssoService.finishSamlLogin({ handle, binding });
      expect(await failureOf(ssoService.finishSamlLogin({ handle, binding }))).toBe(
        "state_invalid",
      );
    });

    it("a browser that did not start the sign-in, and creates no account", async () => {
      expect(await failureOf(signIn(email, {}, { binding: "someone-elses-cookie" }))).toBe(
        "state_invalid",
      );
      expect(await failureOf(signIn(email, {}, { binding: "" }))).toBe("state_invalid");
      await expectNoAccount(email);
    });

    it("a response after the connection was switched off or changed", async () => {
      const { request } = await start(email);
      const samlResponse = idp.respond(request, { nameId: email });
      await configureSaml({ enabled: false });
      expect(
        await failureOf(
          ssoService.handleSamlResponse({ samlResponse, relayState: request.relayState }),
        ),
      ).toBe("unavailable");
    });

    it("a removed member, who stays removed", async () => {
      const member = await createUser(email, ORG_ID);
      await AppDataSource.getRepository(UserOrganization).update(
        { userId: member.id, organizationId: ORG_ID },
        { isActive: false },
      );
      expect(await failureOf(signIn(email))).toBe("account_conflict");
    });
  });

  describe("configuration", () => {
    it("keeps the connection to one protocol and clears the other's credentials", async () => {
      const row = await AppDataSource.getRepository(SsoConnection).findOneOrFail({
        where: { organizationId: ORG_ID },
      });
      expect(row.protocol).toBe("saml");
      expect(row.clientId).toBeNull();
      expect(row.clientSecret).toBeNull();
      expect(row.samlCertificate).toContain("BEGIN CERTIFICATE");
      const view = await ssoService.getConnection(ORG_ID);
      expect(view?.hasClientSecret).toBe(false);
    });

    it("accepts a bare base64 certificate and stores it as PEM", async () => {
      const bare = idp.certificate.replace(/-----[A-Z ]+-----|\s+/g, "");
      await configureSaml({ certificate: bare });
      const row = await AppDataSource.getRepository(SsoConnection).findOneOrFail({
        where: { organizationId: ORG_ID },
      });
      expect(row.samlCertificate).toBe(idp.certificate.trim().replace(/\r/g, ""));
    });

    it("refuses a certificate that is garbage, expired, or a plain-http sign-in URL", async () => {
      await expect(configureSaml({ certificate: "not a certificate" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      const spy = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 90 * 24 * 3600 * 1000);
      await expect(configureSaml()).rejects.toMatchObject({ code: "BAD_REQUEST" });
      spy.mockRestore();
      await expect(
        configureSaml({ ssoUrl: "http://idp.saml-test.example/sso" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("signs people in again after the signing certificate is rotated to a second one", async () => {
      await configureSaml({ certificate: `${idp.otherCertificate}\n${idp.certificate}` });
      await expect(signIn(`rotated@${DOMAIN}`)).resolves.toBeTruthy();
    });

    it("turns off required SSO and drops old links when the provider changes", async () => {
      await signIn(`linked@${DOMAIN}`);
      expect(
        await AppDataSource.getRepository(SsoIdentity).count({ where: { organizationId: ORG_ID } }),
      ).toBe(1);
      await AppDataSource.query(
        `UPDATE organizations SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb), '{ssoEnforced}', 'true') WHERE id = $1`,
        [ORG_ID],
      );
      await configureSaml({ idpEntityId: "https://idp2.saml-test.example/metadata" });
      const org = await AppDataSource.getRepository(Organization).findOneOrFail({
        where: { id: ORG_ID },
      });
      expect(org.settings?.ssoEnforced).toBe(false);
      expect(
        await AppDataSource.getRepository(SsoIdentity).count({ where: { organizationId: ORG_ID } }),
      ).toBe(0);
    });
  });

  describe("body limits", () => {
    it("allow the ACS form post and widen nothing else", () => {
      expect(bodyLimitForPath("/sso/saml/acs")).toBe("400kb");
      expect(bodyLimitForPath("/sso/saml/finish")).toBe("1mb");
      expect(bodyLimitForPath("/sso/callback")).toBe("1mb");
      expect(bodyLimitForPath("/v1/sso.saveConnection")).toBe("1mb");
    });
  });

  describe("over HTTP", () => {
    let server: Server;
    let base: string;

    beforeAll(async () => {
      const app = express();
      app.use((req, res, next) => {
        const limit = bodyLimitForPath(req.path);
        express.urlencoded({ extended: true, limit })(req, res, (err?: unknown) =>
          err ? next(err) : express.json({ limit })(req, res, next),
        );
      });
      app.use(ssoRoutes);
      await new Promise<void>((resolve) => {
        server = app.listen(0, "127.0.0.1", () => resolve());
      });
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    /** The redirect names the public API host; the test server answers on its own port. */
    const local = (location: string | null) => {
      const url = new URL(location as string);
      return `${base}${url.pathname}${url.search}`;
    };

    const form = (fields: Record<string, string>) => ({
      method: "POST",
      redirect: "manual" as const,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });

    async function begin(email: string) {
      const res = await fetch(`${base}/sso/start?email=${encodeURIComponent(email)}`, {
        redirect: "manual",
      });
      const cookie = res.headers.get("set-cookie") ?? "";
      const request = idp.decodeRedirect(res.headers.get("location") as string);
      return { res, cookie, request };
    }

    it("completes across a cross-site POST that carries no cookie, then a same-site GET that does", async () => {
      const email = `http@${DOMAIN}`;
      const { res, cookie, request } = await begin(email);
      expect(res.status).toBe(302);
      expect(cookie).toContain(`${SSO_BINDING_COOKIE}=`);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\/sso/);

      // The browser's POST from the provider: SameSite=Lax cookies are not sent.
      const acs = await fetch(
        `${base}/sso/saml/acs`,
        form({
          SAMLResponse: idp.respond(request, { nameId: email }),
          RelayState: request.relayState,
        }),
      );
      expect(acs.status).toBe(303);
      const finishUrl = acs.headers.get("location") as string;
      expect(finishUrl).toContain("/sso/saml/finish?handle=");
      expect(acs.headers.get("set-cookie")).toBeNull();

      // Following the redirect is a top-level GET, where the cookie does come back.
      const binding = /hay_sso_binding=([^;]+)/.exec(cookie)?.[1] as string;
      const bare = await fetch(local(finishUrl), { redirect: "manual" });
      expect(bare.headers.get("location")).toContain("sso_error=state_invalid");

      // The handle was spent by the attempt without a cookie, so start over for the success path.
      const again = await begin(email);
      const acs2 = await fetch(
        `${base}/sso/saml/acs`,
        form({
          SAMLResponse: idp.respond(again.request, { nameId: email }),
          RelayState: again.request.relayState,
        }),
      );
      const done = await fetch(local(acs2.headers.get("location")), {
        redirect: "manual",
        headers: {
          cookie: `${SSO_BINDING_COOKIE}=${/hay_sso_binding=([^;]+)/.exec(again.cookie)?.[1]}`,
        },
      });
      expect(done.status).toBe(302);
      expect(done.headers.get("location")).toContain("/sso/callback?ticket=");
      expect(binding).toBeTruthy();
    });

    it("refuses a finish carrying another browser's cookie", async () => {
      const email = `http2@${DOMAIN}`;
      const { request } = await begin(email);
      const acs = await fetch(
        `${base}/sso/saml/acs`,
        form({
          SAMLResponse: idp.respond(request, { nameId: email }),
          RelayState: request.relayState,
        }),
      );
      const res = await fetch(local(acs.headers.get("location")), {
        redirect: "manual",
        headers: { cookie: `${SSO_BINDING_COOKIE}=not-the-one` },
      });
      expect(res.headers.get("location")).toContain("sso_error=state_invalid");
      await expectNoAccount(email);
    });

    it("refuses a post with no relay state (provider-initiated) and records the refusal", async () => {
      const email = `idp-initiated@${DOMAIN}`;
      const { request } = await begin(email);
      const res = await fetch(
        `${base}/sso/saml/acs`,
        form({ SAMLResponse: idp.respond(request, { nameId: email }) } as Record<string, string>),
      );
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toContain("sso_error=state_invalid");
      await expectNoAccount(email);
    });

    it("takes only a form post, within the size limit", async () => {
      const json = await fetch(`${base}/sso/saml/acs`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ SAMLResponse: "x", RelayState: "y" }),
      });
      expect(json.headers.get("location")).toContain("sso_error=state_invalid");
      const big = await fetch(
        `${base}/sso/saml/acs`,
        form({ SAMLResponse: "A".repeat(500_000), RelayState: "y" }),
      );
      expect(big.status).toBe(413);
    });

    it("answers a GET on the ACS endpoint with nothing", async () => {
      const res = await fetch(`${base}/sso/saml/acs`, { redirect: "manual" });
      expect(res.status).toBe(404);
    });

    it("serves metadata and 404s for an organization without SAML", async () => {
      const ok = await fetch(`${base}/sso/saml/${ORG_ID}/metadata`);
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain("EntityDescriptor");
      expect((await fetch(`${base}/sso/saml/${OTHER_ORG_ID}/metadata`)).status).toBe(404);
      expect((await fetch(`${base}/sso/saml/not-a-uuid/metadata`)).status).toBe(404);
    });
  });
});
