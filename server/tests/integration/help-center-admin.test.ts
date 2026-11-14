/**
 * The admin side of help centers: setting one up, who may change it, its
 * collections and articles, custom domain proof, and which hostnames resolve
 * to a site.
 */
process.env.HELP_CENTER_DOMAIN = "help.test";
process.env.API_DOMAIN = "api.hay-hc.test";
process.env.DASHBOARD_DOMAIN = "app.hay-hc.test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "help-center-admin-test-secret-0123456789";

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
import { TRPCError } from "@trpc/server";
import { In } from "typeorm";

// No Redis client: the rate-limit middleware lets every call through.
jest.mock("../../services/redis.service", () => ({
  redisService: { isConnected: () => false, getClient: () => null },
}));

import { AppDataSource } from "../../database/data-source";
import { HelpCenter } from "../../database/entities/help-center.entity";
import { HelpCenterArticle } from "../../database/entities/help-center-article.entity";
import { HelpCenterCollection } from "../../database/entities/help-center-collection.entity";
import { AuditLog } from "../../entities/audit-log.entity";
import { Document, DocumentationStatus, DocumentVisibility } from "../../entities/document.entity";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { UserOrganization } from "../../entities/user-organization.entity";
import { AuthUser } from "../../lib/auth/AuthUser";
import { documentsRouter } from "../../routes/v1/documents";
import { helpCenterRouter } from "../../routes/v1/help-center";
import {
  helpCenterService,
  verifyPreviewToken,
} from "../../services/help-center/help-center.service";
import {
  clearHelpCenterHostCache,
  resolveHelpCenterHost,
} from "../../services/help-center/host-resolver";
import type { Context } from "../../trpc/context";
import type { LanguageCode } from "../../types/language.types";
import { purgeAuditLogs } from "../helpers/audit-logs";

const ORG_A = "4c000000-0000-4000-8000-0000000000a1";
const ORG_B = "4c000000-0000-4000-8000-0000000000b2";
const EMAIL_DOMAIN = "hc-admin.test";
const UNKNOWN_ID = "4c000000-0000-4000-8000-00000000dead";
const CUSTOM_DOMAIN = "help.acme-hc.test";

let adminA: User;
let memberA: User;
let adminB: User;

async function ctxFor(user: User, organizationId: string): Promise<Context> {
  const userOrganization = await AppDataSource.getRepository(UserOrganization).findOneOrFail({
    where: { userId: user.id, organizationId },
    relations: ["organization"],
  });
  return {
    user: new AuthUser(user, "jwt", { sessionId: "s", organizationId, userOrganization }),
    organizationId,
    req: { headers: {} },
    res: {},
    ipAddress: "203.0.113.20",
    userAgent: "jest",
  } as unknown as Context;
}

const callerFor = async (user: User, organizationId: string) =>
  helpCenterRouter.createCaller(await ctxFor(user, organizationId));
const asAdminA = () => callerFor(adminA, ORG_A);
const asMemberA = () => callerFor(memberA, ORG_A);
const asAdminB = () => callerFor(adminB, ORG_B);

const actorOf = (user: User) => ({ userId: user.id, ipAddress: "203.0.113.20", userAgent: "jest" });

async function createUser(
  name: string,
  organizationId: string,
  role: "owner" | "admin" | "member",
): Promise<User> {
  const users = AppDataSource.getRepository(User);
  const user = await users.save(
    users.create({
      email: `${name}@${EMAIL_DOMAIN}`,
      password: "x",
      isActive: true,
      emailVerified: true,
    }),
  );
  const memberships = AppDataSource.getRepository(UserOrganization);
  await memberships.save(
    memberships.create({ userId: user.id, organizationId, role, isActive: true }),
  );
  return user;
}

async function createDocument(
  organizationId: string,
  title: string,
  visibility: DocumentVisibility = DocumentVisibility.PRIVATE,
): Promise<Document> {
  const documents = AppDataSource.getRepository(Document);
  return documents.save(
    documents.create({
      organizationId,
      title,
      content: `${title} body`,
      status: DocumentationStatus.PUBLISHED,
      visibility,
    }),
  );
}

const helpCenterOf = (organizationId: string) =>
  AppDataSource.getRepository(HelpCenter).findOneOrFail({ where: { organizationId } });

const documentById = (id: string) =>
  AppDataSource.getRepository(Document).findOneOrFail({ where: { id } });

/** Article rows of a collection, in site order. */
const articlesOf = (collectionId: string) =>
  AppDataSource.getRepository(HelpCenterArticle).find({
    where: { collectionId },
    order: { position: "ASC" },
  });

const collectionsOf = (organizationId: string) =>
  AppDataSource.getRepository(HelpCenterCollection).find({
    where: { organizationId },
    order: { position: "ASC" },
  });

async function auditActions(organizationId: string): Promise<string[]> {
  const rows = await AppDataSource.getRepository(AuditLog).find({
    where: { organizationId },
    order: { createdAt: "ASC" },
  });
  return rows.map((row) => row.action).filter((action) => action.startsWith("help_center."));
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TRPCError) return error.code;
    throw error;
  }
  return "OK";
}

const notFound = () => Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });

/** Answers DNS from the given records; every other name does not exist. */
function mockDns(records: { cname?: Record<string, string[]>; txt?: Record<string, string[][]> }) {
  const cname = jest.spyOn(dns, "resolveCname").mockImplementation((async (name: string) => {
    const answer = records.cname?.[name];
    if (!answer) throw notFound();
    return answer;
  }) as unknown as typeof dns.resolveCname);
  const txt = jest.spyOn(dns, "resolveTxt").mockImplementation((async (name: string) => {
    const answer = records.txt?.[name];
    if (!answer) throw notFound();
    return answer;
  }) as unknown as typeof dns.resolveTxt);
  return { cname, txt };
}

async function createHelpCenter(
  organizationId: string,
  subdomain: string,
  user: User,
): Promise<HelpCenter> {
  return helpCenterService.create(
    organizationId,
    { name: `${subdomain} help`, subdomain, defaultLanguage: "en" },
    actorOf(user),
  );
}

/** Sets the domain and proves it with the CNAME record, as an admin would. */
async function verifiedDomain(organizationId: string, user: User, domain: string) {
  const helpCenter = await helpCenterService.setCustomDomain(organizationId, domain, actorOf(user));
  mockDns({ cname: { [domain]: [`${helpCenter.customDomainTarget}.help.test`] } });
  const verified = await helpCenterService.verifyCustomDomain(organizationId, actorOf(user));
  jest.restoreAllMocks();
  return verified;
}

async function cleanup() {
  clearHelpCenterHostCache();
  const organizationIds = [ORG_A, ORG_B];
  await AppDataSource.getRepository(HelpCenter).delete({ organizationId: In(organizationIds) });
  await AppDataSource.getRepository(Document).delete({ organizationId: In(organizationIds) });
  const users = AppDataSource.getRepository(User);
  const rows = await users
    .createQueryBuilder("u")
    .where("u.email LIKE :pattern", { pattern: `%@${EMAIL_DOMAIN}` })
    .getMany();
  const userIds = rows.map((user) => user.id);
  await purgeAuditLogs(
    "organization_id = ANY($1::uuid[]) OR original_organization_id = ANY($1::uuid[])",
    [organizationIds],
  );
  if (userIds.length) {
    await purgeAuditLogs("user_id = ANY($1::uuid[])", [userIds]);
    await AppDataSource.getRepository(UserOrganization).delete({ userId: In(userIds) });
    await users.delete({ id: In(userIds) });
  }
  await AppDataSource.getRepository(Organization).delete({ id: In(organizationIds) });
}

describe("help center administration", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
  });

  beforeEach(async () => {
    await cleanup();
    const organizations = AppDataSource.getRepository(Organization);
    await organizations.save(
      organizations.create({ id: ORG_A, name: "Café Olé", slug: "hc-admin-a" }),
    );
    await organizations.save(organizations.create({ id: ORG_B, name: "API", slug: "hc-admin-b" }));
    adminA = await createUser("admin-a", ORG_A, "owner");
    memberA = await createUser("member-a", ORG_A, "member");
    adminB = await createUser("admin-b", ORG_B, "admin");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanup();
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  describe("setting up", () => {
    it("offers a subdomain from the organization's name before one exists", async () => {
      const result = await (await asAdminA()).get();
      expect(result).toEqual({
        enabled: true,
        baseDomain: "help.test",
        suggestedSubdomain: "cafe-ole",
        helpCenter: null,
      });
      // "api" is reserved, so there is nothing to offer organization B.
      expect((await (await asAdminB()).get()).suggestedSubdomain).toBe("");
    });

    it("creates an offline help center with a lowercase subdomain and a random CNAME target", async () => {
      const view = await (
        await asAdminA()
      ).create({
        name: "Acme Help",
        subdomain: "  Acme-Support ",
        defaultLanguage: "en" as LanguageCode,
      });

      expect(view.subdomain).toBe("acme-support");
      expect(view.isPublished).toBe(false);
      expect(view.customDomain).toBeNull();
      expect(view.defaultUrl).toBe("http://acme-support.help.test");
      expect(view.url).toBe(view.defaultUrl);

      const stored = await helpCenterOf(ORG_A);
      expect(stored.subdomain).toBe("acme-support");
      expect(stored.name).toBe("Acme Help");
      expect(stored.isPublished).toBe(false);
      expect(stored.searchIndexing).toBe(true);
      expect(stored.customDomainTarget).toMatch(/^hc-[0-9a-f]{20}$/);
      expect(stored.customDomain).toBeNull();
      expect(stored.customDomainVerifiedAt).toBeNull();
      expect(stored.createdBy).toBe(adminA.id);

      const fetched = await (await asAdminA()).get();
      expect(fetched.helpCenter?.id).toBe(stored.id);
      expect(fetched.suggestedSubdomain).toBe("");
    });

    it("gives every help center its own CNAME target", async () => {
      const a = await createHelpCenter(ORG_A, "acme", adminA);
      const b = await createHelpCenter(ORG_B, "globex", adminB);
      expect(a.customDomainTarget).not.toBe(b.customDomainTarget);
    });

    it("refuses a second help center for the same organization", async () => {
      await createHelpCenter(ORG_A, "acme", adminA);
      const caller = await asAdminA();
      expect(
        await codeOf(
          caller.create({
            name: "Again",
            subdomain: "acme-two",
            defaultLanguage: "en" as LanguageCode,
          }),
        ),
      ).toBe("CONFLICT");
      expect(
        await AppDataSource.getRepository(HelpCenter).count({ where: { organizationId: ORG_A } }),
      ).toBe(1);
      expect((await helpCenterOf(ORG_A)).subdomain).toBe("acme");
    });

    it("refuses a subdomain another organization has, whatever its case", async () => {
      await createHelpCenter(ORG_A, "acme", adminA);
      const caller = await asAdminB();
      for (const subdomain of ["acme", "ACME", " Acme "]) {
        expect(
          await codeOf(
            caller.create({
              name: "Copycat",
              subdomain,
              defaultLanguage: "en" as LanguageCode,
            }),
          ),
        ).toBe("CONFLICT");
      }
      expect(await helpCenterService.findByOrganization(ORG_B)).toBeNull();
    });

    it.each([
      "www",
      "api",
      "admin",
      "hc-abcdef",
      "ab",
      "-acme",
      "acme_support",
      "acme.support",
      "xn--caf-dma",
      "café",
    ])("refuses the subdomain %s", async (subdomain) => {
      const caller = await asAdminA();
      expect(
        await codeOf(
          caller.create({ name: "Acme", subdomain, defaultLanguage: "en" as LanguageCode }),
        ),
      ).toBe("BAD_REQUEST");
      expect(await helpCenterService.findByOrganization(ORG_A)).toBeNull();
    });

    it("refuses an unsupported language and an empty name at the router", async () => {
      const caller = await asAdminA();
      expect(
        await codeOf(
          caller.create({ name: "Acme", subdomain: "acme", defaultLanguage: "tlh" as never }),
        ),
      ).toBe("BAD_REQUEST");
      expect(
        await codeOf(
          caller.create({
            name: "   ",
            subdomain: "acme",
            defaultLanguage: "en" as LanguageCode,
          }),
        ),
      ).toBe("BAD_REQUEST");
      expect(await helpCenterService.findByOrganization(ORG_A)).toBeNull();
    });

    it("reports another organization's subdomain as taken but the organization's own as available", async () => {
      await createHelpCenter(ORG_A, "acme", adminA);
      const a = await asAdminA();
      const b = await asAdminB();

      expect(await b.checkSubdomain({ subdomain: "acme" })).toEqual({
        available: false,
        reason: "taken",
      });
      expect(await b.checkSubdomain({ subdomain: "ACME" })).toEqual({
        available: false,
        reason: "taken",
      });
      expect(await a.checkSubdomain({ subdomain: "acme" })).toEqual({ available: true });
      expect(await b.checkSubdomain({ subdomain: "globex" })).toEqual({ available: true });
      expect(await b.checkSubdomain({ subdomain: "www" })).toEqual({
        available: false,
        reason: "reserved",
      });
      expect(await b.checkSubdomain({ subdomain: "ab" })).toEqual({
        available: false,
        reason: "too_short",
      });
      expect(await b.checkSubdomain({ subdomain: "a_b" })).toEqual({
        available: false,
        reason: "invalid_characters",
      });
    });

    it("updates name, theme and subdomain, and frees the old address", async () => {
      await createHelpCenter(ORG_A, "acme", adminA);
      await createHelpCenter(ORG_B, "globex", adminB);
      const caller = await asAdminA();
      expect((await resolveHelpCenterHost("acme.help.test")).kind).toBe("site");

      await caller.update({ theme: { font: "serif" } });
      const view = await caller.update({
        name: "Acme Answers",
        subdomain: "Acme-Answers",
        searchIndexing: false,
        theme: { accentColor: "#ff0000" },
      });
      expect(view.name).toBe("Acme Answers");
      expect(view.subdomain).toBe("acme-answers");
      expect(view.searchIndexing).toBe(false);
      expect(view.theme).toMatchObject({ font: "serif", accentColor: "#ff0000", layout: "cards" });
      expect((await helpCenterOf(ORG_A)).theme).toEqual({ font: "serif", accentColor: "#ff0000" });

      expect((await resolveHelpCenterHost("acme.help.test")).kind).toBe("unknown");
      expect((await resolveHelpCenterHost("acme-answers.help.test")).kind).toBe("site");

      // Keeping its own address is fine; taking a neighbour's or a reserved one is not.
      expect(await codeOf(caller.update({ subdomain: "acme-answers" }))).toBe("OK");
      expect(await codeOf(caller.update({ subdomain: "globex" }))).toBe("CONFLICT");
      expect(await codeOf(caller.update({ subdomain: "admin" }))).toBe("BAD_REQUEST");
      expect(await codeOf(caller.update({ theme: { accentColor: "red" } }))).toBe("BAD_REQUEST");
      expect((await helpCenterOf(ORG_A)).subdomain).toBe("acme-answers");
    });

    it("publishes and unpublishes", async () => {
      await createHelpCenter(ORG_A, "acme", adminA);
      const caller = await asAdminA();
      expect((await caller.setPublished({ published: true })).isPublished).toBe(true);
      expect((await helpCenterOf(ORG_A)).isPublished).toBe(true);
      expect((await caller.setPublished({ published: false })).isPublished).toBe(false);
      expect((await helpCenterOf(ORG_A)).isPublished).toBe(false);
    });

    it("needs a help center before anything can be changed", async () => {
      const caller = await asAdminA();
      expect(await codeOf(caller.setPublished({ published: true }))).toBe("NOT_FOUND");
      expect(await codeOf(caller.update({ name: "x" }))).toBe("NOT_FOUND");
      expect(await codeOf(caller.createCollection({ title: "x" }))).toBe("NOT_FOUND");
      expect(await codeOf(caller.setCustomDomain({ domain: CUSTOM_DOMAIN }))).toBe("NOT_FOUND");
      expect(await caller.listCollections()).toEqual([]);
      expect(await caller.getPreviewLink()).toBeNull();
    });

    it("hands out a preview link that verifies for this help center only", async () => {
      const a = await createHelpCenter(ORG_A, "acme", adminA);
      const b = await createHelpCenter(ORG_B, "globex", adminB);
      const link = await (await asMemberA()).getPreviewLink();
      expect(link?.baseUrl).toBe("http://acme.help.test");
      expect(verifyPreviewToken(a.id, link?.token)).toBe(true);
      expect(verifyPreviewToken(b.id, link?.token)).toBe(false);
    });
  });

  describe("authorization", () => {
    it("refuses every change from a member", async () => {
      const document = await createDocument(ORG_A, "Refunds");
      const member = await asMemberA();

      expect(
        await codeOf(
          member.create({
            name: "Acme",
            subdomain: "acme",
            defaultLanguage: "en" as LanguageCode,
          }),
        ),
      ).toBe("FORBIDDEN");
      expect(await helpCenterService.findByOrganization(ORG_A)).toBeNull();

      await createHelpCenter(ORG_A, "acme", adminA);
      const collection = await helpCenterService.createCollection(ORG_A, { title: "Billing" });

      expect(await codeOf(member.setPublished({ published: true }))).toBe("FORBIDDEN");
      expect(
        await codeOf(
          member.setCollectionArticles({ collectionId: collection.id, documentIds: [document.id] }),
        ),
      ).toBe("FORBIDDEN");
      expect(await codeOf(member.setCustomDomain({ domain: CUSTOM_DOMAIN }))).toBe("FORBIDDEN");
      expect(await codeOf(member.verifyCustomDomain())).toBe("FORBIDDEN");
      expect(await codeOf(member.removeCustomDomain())).toBe("FORBIDDEN");
      expect(await codeOf(member.update({ name: "Hacked" }))).toBe("FORBIDDEN");
      expect(await codeOf(member.createCollection({ title: "Mine" }))).toBe("FORBIDDEN");
      expect(await codeOf(member.updateCollection({ id: collection.id, title: "Mine" }))).toBe(
        "FORBIDDEN",
      );
      expect(await codeOf(member.deleteCollection({ id: collection.id }))).toBe("FORBIDDEN");
      expect(await codeOf(member.reorderCollections({ ids: [collection.id] }))).toBe("FORBIDDEN");
      expect(await codeOf(member.checkSubdomain({ subdomain: "acme" }))).toBe("FORBIDDEN");

      const stored = await helpCenterOf(ORG_A);
      expect(stored.isPublished).toBe(false);
      expect(stored.name).toBe("acme help");
      expect(stored.customDomain).toBeNull();
      expect(await articlesOf(collection.id)).toEqual([]);
      expect((await documentById(document.id)).visibility).toBe(DocumentVisibility.PRIVATE);
      expect((await collectionsOf(ORG_A)).map((row) => row.title)).toEqual(["Billing"]);
    });

    it("lets a member read", async () => {
      await createHelpCenter(ORG_A, "acme", adminA);
      await helpCenterService.createCollection(ORG_A, { title: "Billing" });
      const member = await asMemberA();
      expect((await member.get()).helpCenter?.subdomain).toBe("acme");
      expect((await member.listCollections()).map((row) => row.title)).toEqual(["Billing"]);
    });

    it("refuses a caller who is not signed in", async () => {
      const anonymous = helpCenterRouter.createCaller({
        user: null,
        organizationId: null,
        req: { headers: {} },
        res: {},
      } as unknown as Context);
      expect(await codeOf(anonymous.get())).toBe("UNAUTHORIZED");
      expect(await codeOf(anonymous.setPublished({ published: true }))).toBe("UNAUTHORIZED");
    });

    it("keeps another organization's admin out of a collection", async () => {
      await createHelpCenter(ORG_A, "acme", adminA);
      await createHelpCenter(ORG_B, "globex", adminB);
      const collection = await helpCenterService.createCollection(ORG_A, { title: "Billing" });
      const documentA = await createDocument(ORG_A, "Refunds");
      const documentB = await createDocument(ORG_B, "Theirs");
      await helpCenterService.setCollectionArticles(ORG_A, collection.id, [documentA.id]);
      const b = await asAdminB();

      expect(await codeOf(b.updateCollection({ id: collection.id, title: "Taken over" }))).toBe(
        "NOT_FOUND",
      );
      expect(
        await codeOf(
          b.setCollectionArticles({ collectionId: collection.id, documentIds: [documentB.id] }),
        ),
      ).toBe("NOT_FOUND");
      expect(
        await codeOf(b.setCollectionArticles({ collectionId: collection.id, documentIds: [] })),
      ).toBe("NOT_FOUND");
      await b.deleteCollection({ id: collection.id });

      const rows = await collectionsOf(ORG_A);
      expect(rows.map((row) => row.title)).toEqual(["Billing"]);
      expect((await articlesOf(collection.id)).map((row) => row.documentId)).toEqual([
        documentA.id,
      ]);
      expect((await documentById(documentB.id)).visibility).toBe(DocumentVisibility.PRIVATE);
      expect(await b.listCollections()).toEqual([]);
    });

    it("ignores another organization's ids when reordering", async () => {
      await createHelpCenter(ORG_A, "acme", adminA);
      await createHelpCenter(ORG_B, "globex", adminB);
      const first = await helpCenterService.createCollection(ORG_A, { title: "One" });
      const second = await helpCenterService.createCollection(ORG_A, { title: "Two" });
      const third = await helpCenterService.createCollection(ORG_A, { title: "Three" });

      await (await asAdminB()).reorderCollections({ ids: [third.id, second.id, first.id] });

      expect((await collectionsOf(ORG_A)).map((row) => [row.title, row.position])).toEqual([
        ["One", 0],
        ["Two", 1],
        ["Three", 2],
      ]);
    });
  });

  describe("collections", () => {
    beforeEach(async () => {
      await createHelpCenter(ORG_A, "acme", adminA);
    });

    it("appends a new collection at the end", async () => {
      const caller = await asAdminA();
      const one = await caller.createCollection({ title: "One", description: "First", icon: "📦" });
      const two = await caller.createCollection({ title: " Two " });
      const three = await caller.createCollection({ title: "Three" });

      const rows = await collectionsOf(ORG_A);
      expect(rows.map((row) => [row.id, row.position])).toEqual([
        [one.id, 0],
        [two.id, 1],
        [three.id, 2],
      ]);
      expect(await caller.listCollections()).toEqual([
        { id: one.id, title: "One", description: "First", icon: "📦", articles: [] },
        { id: two.id, title: "Two", description: null, icon: null, articles: [] },
        { id: three.id, title: "Three", description: null, icon: null, articles: [] },
      ]);
    });

    it("appends after the highest position once collections were reordered or deleted", async () => {
      const caller = await asAdminA();
      const one = await caller.createCollection({ title: "One" });
      const two = await caller.createCollection({ title: "Two" });
      const three = await caller.createCollection({ title: "Three" });
      await caller.reorderCollections({ ids: [three.id, one.id, two.id] });
      await caller.deleteCollection({ id: one.id });
      const four = await caller.createCollection({ title: "Four" });

      expect((await caller.listCollections()).map((row) => row.id)).toEqual([
        three.id,
        two.id,
        four.id,
      ]);
    });

    it("persists a new order", async () => {
      const caller = await asAdminA();
      const one = await caller.createCollection({ title: "One" });
      const two = await caller.createCollection({ title: "Two" });
      const three = await caller.createCollection({ title: "Three" });

      await caller.reorderCollections({ ids: [three.id, one.id, two.id] });

      expect((await caller.listCollections()).map((row) => row.title)).toEqual([
        "Three",
        "One",
        "Two",
      ]);
      expect((await collectionsOf(ORG_A)).map((row) => row.position)).toEqual([0, 1, 2]);
    });

    it("updates only the fields given", async () => {
      const caller = await asAdminA();
      const { id } = await caller.createCollection({
        title: "Billing",
        description: "Invoices",
        icon: "💳",
      });

      await caller.updateCollection({ id, title: "Payments" });
      let [row] = await collectionsOf(ORG_A);
      expect(row).toMatchObject({ title: "Payments", description: "Invoices", icon: "💳" });

      await caller.updateCollection({ id, description: null, icon: null });
      [row] = await collectionsOf(ORG_A);
      expect(row).toMatchObject({ title: "Payments", description: null, icon: null });

      expect(await codeOf(caller.updateCollection({ id, title: "" }))).toBe("BAD_REQUEST");
      expect(await codeOf(caller.updateCollection({ id: UNKNOWN_ID, title: "x" }))).toBe(
        "NOT_FOUND",
      );
    });

    it("deletes a collection with its article rows and leaves the documents", async () => {
      const caller = await asAdminA();
      const billing = await caller.createCollection({ title: "Billing" });
      const shipping = await caller.createCollection({ title: "Shipping" });
      const refunds = await createDocument(ORG_A, "Refunds");
      const delivery = await createDocument(ORG_A, "Delivery");
      await caller.setCollectionArticles({ collectionId: billing.id, documentIds: [refunds.id] });
      await caller.setCollectionArticles({ collectionId: shipping.id, documentIds: [delivery.id] });

      await caller.deleteCollection({ id: billing.id });

      expect((await collectionsOf(ORG_A)).map((row) => row.id)).toEqual([shipping.id]);
      const articles = await AppDataSource.getRepository(HelpCenterArticle).find({
        where: { organizationId: ORG_A },
      });
      expect(articles.map((row) => row.documentId)).toEqual([delivery.id]);
      const kept = await documentById(refunds.id);
      expect(kept.title).toBe("Refunds");
      expect(kept.visibility).toBe(DocumentVisibility.PUBLIC);
    });
  });

  describe("setCollectionArticles", () => {
    let caller: Awaited<ReturnType<typeof asAdminA>>;
    let billing: string;
    let shipping: string;

    beforeEach(async () => {
      await createHelpCenter(ORG_A, "acme", adminA);
      caller = await asAdminA();
      billing = (await caller.createCollection({ title: "Billing" })).id;
      shipping = (await caller.createCollection({ title: "Shipping" })).id;
    });

    const documentIdsOf = async (collectionId: string) =>
      (await articlesOf(collectionId)).map((row) => row.documentId);

    it("stores the articles in the order given and reorders them", async () => {
      const [a, b, c] = await Promise.all(
        ["A", "B", "C"].map((title) => createDocument(ORG_A, title)),
      );

      await caller.setCollectionArticles({
        collectionId: billing,
        documentIds: [b.id, c.id, a.id],
      });
      expect(await documentIdsOf(billing)).toEqual([b.id, c.id, a.id]);
      expect((await articlesOf(billing)).map((row) => row.position)).toEqual([0, 1, 2]);

      await caller.setCollectionArticles({
        collectionId: billing,
        documentIds: [a.id, b.id, c.id],
      });
      expect(await documentIdsOf(billing)).toEqual([a.id, b.id, c.id]);

      const listed = (await caller.listCollections()).find((row) => row.id === billing);
      expect(listed?.articles.map((article) => article.title)).toEqual(["A", "B", "C"]);
    });

    it("makes every listed document public", async () => {
      const privateDoc = await createDocument(ORG_A, "Private", DocumentVisibility.PRIVATE);
      const internalDoc = await createDocument(ORG_A, "Internal", DocumentVisibility.INTERNAL);
      const publicDoc = await createDocument(ORG_A, "Public", DocumentVisibility.PUBLIC);
      const untouched = await createDocument(ORG_A, "Untouched", DocumentVisibility.PRIVATE);

      await caller.setCollectionArticles({
        collectionId: billing,
        documentIds: [privateDoc.id, internalDoc.id, publicDoc.id],
      });

      for (const document of [privateDoc, internalDoc, publicDoc]) {
        expect((await documentById(document.id)).visibility).toBe(DocumentVisibility.PUBLIC);
      }
      expect((await documentById(untouched.id)).visibility).toBe(DocumentVisibility.PRIVATE);

      const listed = (await caller.listCollections()).find((row) => row.id === billing);
      expect(listed?.articles.map((article) => [article.visibility, article.live])).toEqual([
        ["public", true],
        ["public", true],
        ["public", true],
      ]);
    });

    it("shows a draft article as not live", async () => {
      const draft = await createDocument(ORG_A, "Draft");
      await AppDataSource.getRepository(Document).update(draft.id, {
        status: DocumentationStatus.DRAFT,
      });
      await caller.setCollectionArticles({ collectionId: billing, documentIds: [draft.id] });
      const listed = (await caller.listCollections()).find((row) => row.id === billing);
      expect(listed?.articles).toEqual([
        {
          documentId: draft.id,
          title: "Draft",
          status: "draft",
          visibility: "public",
          live: false,
          helpfulCount: 0,
          unhelpfulCount: 0,
        },
      ]);
    });

    it("moves a document from another collection, keeping one row and its feedback counts", async () => {
      const [a, b] = await Promise.all(["A", "B"].map((title) => createDocument(ORG_A, title)));
      await caller.setCollectionArticles({ collectionId: billing, documentIds: [a.id, b.id] });
      await AppDataSource.getRepository(HelpCenterArticle).update(
        { documentId: a.id },
        { helpfulCount: 7, unhelpfulCount: 2 },
      );
      const before = await AppDataSource.getRepository(HelpCenterArticle).findOneOrFail({
        where: { documentId: a.id },
      });

      await caller.setCollectionArticles({ collectionId: shipping, documentIds: [a.id] });

      const rows = await AppDataSource.getRepository(HelpCenterArticle).find({
        where: { documentId: a.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: before.id,
        collectionId: shipping,
        position: 0,
        helpfulCount: 7,
        unhelpfulCount: 2,
      });
      expect(await documentIdsOf(billing)).toEqual([b.id]);
      expect(await documentIdsOf(shipping)).toEqual([a.id]);
    });

    it("keeps feedback counts when the same collection is saved again", async () => {
      const [a, b] = await Promise.all(["A", "B"].map((title) => createDocument(ORG_A, title)));
      await caller.setCollectionArticles({ collectionId: billing, documentIds: [a.id, b.id] });
      await AppDataSource.getRepository(HelpCenterArticle).update(
        { documentId: b.id },
        { helpfulCount: 3, unhelpfulCount: 1 },
      );

      await caller.setCollectionArticles({ collectionId: billing, documentIds: [b.id, a.id] });

      const [first] = await articlesOf(billing);
      expect(first).toMatchObject({ documentId: b.id, helpfulCount: 3, unhelpfulCount: 1 });
    });

    it("removes a document that is no longer listed and leaves its visibility", async () => {
      const [a, b] = await Promise.all(["A", "B"].map((title) => createDocument(ORG_A, title)));
      await caller.setCollectionArticles({ collectionId: billing, documentIds: [a.id, b.id] });

      await caller.setCollectionArticles({ collectionId: billing, documentIds: [b.id] });

      expect(await documentIdsOf(billing)).toEqual([b.id]);
      expect(
        await AppDataSource.getRepository(HelpCenterArticle).count({ where: { documentId: a.id } }),
      ).toBe(0);
      expect((await documentById(a.id)).visibility).toBe(DocumentVisibility.PUBLIC);
    });

    it("leaves other collections alone", async () => {
      const [a, b] = await Promise.all(["A", "B"].map((title) => createDocument(ORG_A, title)));
      await caller.setCollectionArticles({ collectionId: billing, documentIds: [a.id] });
      await caller.setCollectionArticles({ collectionId: shipping, documentIds: [b.id] });
      await caller.setCollectionArticles({ collectionId: shipping, documentIds: [] });
      expect(await documentIdsOf(billing)).toEqual([a.id]);
    });

    it("refuses another organization's document and writes nothing", async () => {
      await createHelpCenter(ORG_B, "globex", adminB);
      const mine = await createDocument(ORG_A, "Mine");
      const existing = await createDocument(ORG_A, "Existing");
      const theirs = await createDocument(ORG_B, "Theirs");
      await caller.setCollectionArticles({ collectionId: billing, documentIds: [existing.id] });

      expect(
        await codeOf(
          caller.setCollectionArticles({
            collectionId: billing,
            documentIds: [mine.id, theirs.id],
          }),
        ),
      ).toBe("NOT_FOUND");
      expect(
        await codeOf(
          caller.setCollectionArticles({ collectionId: billing, documentIds: [UNKNOWN_ID] }),
        ),
      ).toBe("NOT_FOUND");

      expect(await documentIdsOf(billing)).toEqual([existing.id]);
      expect((await documentById(mine.id)).visibility).toBe(DocumentVisibility.PRIVATE);
      expect((await documentById(theirs.id)).visibility).toBe(DocumentVisibility.PRIVATE);
      expect(
        await AppDataSource.getRepository(HelpCenterArticle).count({
          where: { documentId: In([mine.id, theirs.id]) },
        }),
      ).toBe(0);
    });

    it("cannot pull a document out of another organization's collection", async () => {
      await createHelpCenter(ORG_B, "globex", adminB);
      const theirCollection = await helpCenterService.createCollection(ORG_B, { title: "Theirs" });
      const theirs = await createDocument(ORG_B, "Theirs");
      await helpCenterService.setCollectionArticles(ORG_B, theirCollection.id, [theirs.id]);

      expect(
        await codeOf(
          caller.setCollectionArticles({ collectionId: billing, documentIds: [theirs.id] }),
        ),
      ).toBe("NOT_FOUND");
      expect((await articlesOf(theirCollection.id)).map((row) => row.documentId)).toEqual([
        theirs.id,
      ]);
    });

    it("tolerates duplicate ids", async () => {
      const [a, b] = await Promise.all(["A", "B"].map((title) => createDocument(ORG_A, title)));
      await caller.setCollectionArticles({
        collectionId: billing,
        documentIds: [a.id, b.id, a.id, a.id],
      });
      const rows = await articlesOf(billing);
      expect(rows.map((row) => [row.documentId, row.position])).toEqual([
        [a.id, 0],
        [b.id, 1],
      ]);
    });

    it("clears the collection with an empty list", async () => {
      const [a, b] = await Promise.all(["A", "B"].map((title) => createDocument(ORG_A, title)));
      await caller.setCollectionArticles({ collectionId: billing, documentIds: [a.id, b.id] });

      await caller.setCollectionArticles({ collectionId: billing, documentIds: [] });

      expect(await articlesOf(billing)).toEqual([]);
      expect((await documentById(a.id)).visibility).toBe(DocumentVisibility.PUBLIC);
      expect((await collectionsOf(ORG_A)).map((row) => row.id)).toContain(billing);
    });

    it("refuses an unknown collection and malformed ids", async () => {
      const a = await createDocument(ORG_A, "A");
      expect(
        await codeOf(
          caller.setCollectionArticles({ collectionId: UNKNOWN_ID, documentIds: [a.id] }),
        ),
      ).toBe("NOT_FOUND");
      expect(
        await codeOf(
          caller.setCollectionArticles({ collectionId: billing, documentIds: ["not-a-uuid"] }),
        ),
      ).toBe("BAD_REQUEST");
      expect((await documentById(a.id)).visibility).toBe(DocumentVisibility.PRIVATE);
    });

    it("drops the article row when its document is deleted", async () => {
      const a = await createDocument(ORG_A, "A");
      await caller.setCollectionArticles({ collectionId: billing, documentIds: [a.id] });
      await AppDataSource.getRepository(Document).delete({ id: a.id });
      expect(await articlesOf(billing)).toEqual([]);
    });
  });

  describe("custom domain", () => {
    let helpCenterA: HelpCenter;
    let helpCenterB: HelpCenter;

    beforeEach(async () => {
      helpCenterA = await createHelpCenter(ORG_A, "acme", adminA);
      helpCenterB = await createHelpCenter(ORG_B, "globex", adminB);
    });

    it("normalises case and a trailing dot", async () => {
      const view = await (await asAdminA()).setCustomDomain({ domain: "  Help.Acme-HC.Test.  " });
      expect(view.customDomain).toEqual({
        domain: CUSTOM_DOMAIN,
        verified: false,
        verifiedAt: null,
        checkedAt: null,
        records: {
          cname: { name: CUSTOM_DOMAIN, value: `${helpCenterA.customDomainTarget}.help.test` },
          txt: {
            name: `_hay-help-center.${CUSTOM_DOMAIN}`,
            value: `hay-help-center=${helpCenterA.customDomainTarget}`,
          },
        },
      });
      expect(view.url).toBe("http://acme.help.test");
      expect((await helpCenterOf(ORG_A)).customDomain).toBe(CUSTOM_DOMAIN);
    });

    it.each([
      ["the help center domain", "help.test"],
      ["the help center domain in another case", "HELP.Test."],
      ["a subdomain of it", "acme.help.test"],
      ["another site's address", "globex.help.test"],
      ["a nested name under it", "a.b.help.test"],
      ["a bare word", "localhost"],
      ["words", "not a domain"],
      ["a URL", "https://help.acme-hc.test"],
      ["a name with a path", "help.acme-hc.test/docs"],
      ["a name with a port", "help.acme-hc.test:8080"],
      ["an underscore label", "help_center.acme-hc.test"],
      ["a wildcard", "*.acme-hc.test"],
      ["an IP address", "203.0.113.5"],
    ])("refuses %s", async (_what, domain) => {
      expect(await codeOf((await asAdminA()).setCustomDomain({ domain }))).toBe("BAD_REQUEST");
      expect((await helpCenterOf(ORG_A)).customDomain).toBeNull();
    });

    it("fails verification when neither record exists and records the check", async () => {
      const caller = await asAdminA();
      await caller.setCustomDomain({ domain: CUSTOM_DOMAIN });
      const { cname, txt } = mockDns({});
      const before = Date.now();

      expect(await codeOf(caller.verifyCustomDomain())).toBe("PRECONDITION_FAILED");

      expect(cname).toHaveBeenCalledWith(CUSTOM_DOMAIN);
      expect(txt).toHaveBeenCalledWith(`_hay-help-center.${CUSTOM_DOMAIN}`);
      const stored = await helpCenterOf(ORG_A);
      expect(stored.customDomainVerifiedAt).toBeNull();
      expect(stored.customDomainCheckedAt).toBeInstanceOf(Date);
      expect(stored.customDomainCheckedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect((await resolveHelpCenterHost(CUSTOM_DOMAIN)).kind).toBe("none");
      expect((await caller.get()).helpCenter?.customDomain?.checkedAt).not.toBeNull();
    });

    it("cannot verify before a domain is set", async () => {
      mockDns({});
      expect(await codeOf((await asAdminA()).verifyCustomDomain())).toBe("BAD_REQUEST");
    });

    it.each([
      ["as is", (target: string) => `${target}.help.test`],
      ["with a trailing dot", (target: string) => `${target}.help.test.`],
      ["in another case", (target: string) => `${target}.Help.TEST`.toUpperCase()],
    ])("verifies through a CNAME to its target, %s", async (_what, answer) => {
      const caller = await asAdminA();
      await caller.setCustomDomain({ domain: CUSTOM_DOMAIN });
      mockDns({ cname: { [CUSTOM_DOMAIN]: [answer(helpCenterA.customDomainTarget)] } });

      const view = await caller.verifyCustomDomain();

      expect(view.customDomain?.verified).toBe(true);
      expect(view.url).toBe(`http://${CUSTOM_DOMAIN}`);
      expect(view.defaultUrl).toBe("http://acme.help.test");
      const stored = await helpCenterOf(ORG_A);
      expect(stored.customDomainVerifiedAt).toBeInstanceOf(Date);
      expect(stored.customDomainFailures).toBe(0);
      const match = await resolveHelpCenterHost(CUSTOM_DOMAIN);
      expect(match.kind === "site" && match.helpCenter.id).toBe(helpCenterA.id);
    });

    it("verifies through the TXT record alone", async () => {
      const caller = await asAdminA();
      await caller.setCustomDomain({ domain: CUSTOM_DOMAIN });
      mockDns({
        txt: {
          [`_hay-help-center.${CUSTOM_DOMAIN}`]: [
            ["v=spf1 -all"],
            // DNS may split one value into chunks.
            ["hay-help-center=", helpCenterA.customDomainTarget],
          ],
        },
      });
      expect((await caller.verifyCustomDomain()).customDomain?.verified).toBe(true);
    });

    it("does not verify on a TXT record at the domain itself or with another value", async () => {
      const caller = await asAdminA();
      await caller.setCustomDomain({ domain: CUSTOM_DOMAIN });
      mockDns({
        txt: {
          [CUSTOM_DOMAIN]: [[`hay-help-center=${helpCenterA.customDomainTarget}`]],
          [`_hay-help-center.${CUSTOM_DOMAIN}`]: [
            [`hay-help-center=${helpCenterB.customDomainTarget}`],
            [`hay-help-center=${helpCenterA.customDomainTarget}x`],
            [helpCenterA.customDomainTarget],
          ],
        },
      });
      expect(await codeOf(caller.verifyCustomDomain())).toBe("PRECONDITION_FAILED");
    });

    it("does not verify on a CNAME to another help center's target or to its subdomain", async () => {
      const caller = await asAdminA();
      await caller.setCustomDomain({ domain: CUSTOM_DOMAIN });
      mockDns({
        cname: {
          [CUSTOM_DOMAIN]: [
            `${helpCenterB.customDomainTarget}.help.test`,
            "acme.help.test",
            "help.test",
            `${helpCenterA.customDomainTarget}.help.test.evil.test`,
            helpCenterA.customDomainTarget,
          ],
        },
      });
      expect(await codeOf(caller.verifyCustomDomain())).toBe("PRECONDITION_FAILED");
      expect((await helpCenterOf(ORG_A)).customDomainVerifiedAt).toBeNull();
    });

    it("keeps a domain with its verified owner", async () => {
      await verifiedDomain(ORG_A, adminA, CUSTOM_DOMAIN);
      const b = await asAdminB();

      // Claiming is allowed (an unproven claim blocks nobody), proving is what counts.
      await b.setCustomDomain({ domain: CUSTOM_DOMAIN });
      mockDns({ cname: { [CUSTOM_DOMAIN]: [`${helpCenterA.customDomainTarget}.help.test`] } });
      expect(await codeOf(b.verifyCustomDomain())).toBe("PRECONDITION_FAILED");
      expect((await helpCenterOf(ORG_B)).customDomainVerifiedAt).toBeNull();
      let match = await resolveHelpCenterHost(CUSTOM_DOMAIN);
      expect(match.kind === "site" && match.helpCenter.id).toBe(helpCenterA.id);

      // Even if DNS did show B's target, one domain serves one help center.
      jest.restoreAllMocks();
      mockDns({ cname: { [CUSTOM_DOMAIN]: [`${helpCenterB.customDomainTarget}.help.test`] } });
      expect(await codeOf(b.verifyCustomDomain())).toBe("CONFLICT");

      expect((await helpCenterOf(ORG_B)).customDomainVerifiedAt).toBeNull();
      expect((await helpCenterOf(ORG_A)).customDomainVerifiedAt).toBeInstanceOf(Date);
      clearHelpCenterHostCache();
      match = await resolveHelpCenterHost(CUSTOM_DOMAIN);
      expect(match.kind === "site" && match.helpCenter.id).toBe(helpCenterA.id);
      expect(await auditActions(ORG_B)).not.toContain("help_center.domain.verify");
    });

    it("lets the second claimant verify once the first has let go", async () => {
      await verifiedDomain(ORG_A, adminA, CUSTOM_DOMAIN);
      const b = await asAdminB();
      await b.setCustomDomain({ domain: CUSTOM_DOMAIN });
      await (await asAdminA()).removeCustomDomain();
      mockDns({ cname: { [CUSTOM_DOMAIN]: [`${helpCenterB.customDomainTarget}.help.test`] } });

      expect((await b.verifyCustomDomain()).customDomain?.verified).toBe(true);
      const match = await resolveHelpCenterHost(CUSTOM_DOMAIN);
      expect(match.kind === "site" && match.helpCenter.id).toBe(helpCenterB.id);
    });

    it("does not look DNS up again once verified", async () => {
      await verifiedDomain(ORG_A, adminA, CUSTOM_DOMAIN);
      const { cname, txt } = mockDns({});
      expect((await (await asAdminA()).verifyCustomDomain()).customDomain?.verified).toBe(true);
      expect(cname).not.toHaveBeenCalled();
      expect(txt).not.toHaveBeenCalled();
    });

    it("clears verification when the domain changes, and keeps it when it does not", async () => {
      await verifiedDomain(ORG_A, adminA, CUSTOM_DOMAIN);
      const caller = await asAdminA();

      const same = await caller.setCustomDomain({ domain: CUSTOM_DOMAIN.toUpperCase() });
      expect(same.customDomain?.verified).toBe(true);

      const changed = await caller.setCustomDomain({ domain: "docs.acme-hc.test" });
      expect(changed.customDomain).toMatchObject({
        domain: "docs.acme-hc.test",
        verified: false,
        checkedAt: null,
      });
      const stored = await helpCenterOf(ORG_A);
      expect(stored.customDomainVerifiedAt).toBeNull();
      expect(stored.customDomainCheckedAt).toBeNull();
      expect(stored.customDomainFailures).toBe(0);
      expect(stored.customDomainTarget).toBe(helpCenterA.customDomainTarget);
      expect((await resolveHelpCenterHost(CUSTOM_DOMAIN)).kind).toBe("none");
      expect((await resolveHelpCenterHost("docs.acme-hc.test")).kind).toBe("none");
      expect(changed.url).toBe("http://acme.help.test");
    });

    it("removes the domain and everything about it", async () => {
      await verifiedDomain(ORG_A, adminA, CUSTOM_DOMAIN);
      expect((await resolveHelpCenterHost(CUSTOM_DOMAIN)).kind).toBe("site");

      const view = await (await asAdminA()).removeCustomDomain();

      expect(view.customDomain).toBeNull();
      expect(view.url).toBe("http://acme.help.test");
      const stored = await helpCenterOf(ORG_A);
      expect(stored.customDomain).toBeNull();
      expect(stored.customDomainVerifiedAt).toBeNull();
      expect(stored.customDomainCheckedAt).toBeNull();
      expect(stored.customDomainFailures).toBe(0);
      expect((await resolveHelpCenterHost(CUSTOM_DOMAIN)).kind).toBe("none");
      expect((await resolveHelpCenterHost("acme.help.test")).kind).toBe("site");
      // Removing again is a no-op.
      expect(await codeOf((await asAdminA()).removeCustomDomain())).toBe("OK");
    });

    describe("daily re-check", () => {
      const valid = () =>
        mockDns({ cname: { [CUSTOM_DOMAIN]: [`${helpCenterA.customDomainTarget}.help.test`] } });

      it("counts failures, resets them on success and unverifies after three in a row", async () => {
        await verifiedDomain(ORG_A, adminA, CUSTOM_DOMAIN);
        expect((await resolveHelpCenterHost(CUSTOM_DOMAIN)).kind).toBe("site");

        mockDns({});
        await helpCenterService.recheckCustomDomains();
        await helpCenterService.recheckCustomDomains();
        let stored = await helpCenterOf(ORG_A);
        expect(stored.customDomainFailures).toBe(2);
        expect(stored.customDomainVerifiedAt).toBeInstanceOf(Date);
        expect(stored.customDomainCheckedAt).toBeInstanceOf(Date);
        expect((await resolveHelpCenterHost(CUSTOM_DOMAIN)).kind).toBe("site");

        jest.restoreAllMocks();
        valid();
        await helpCenterService.recheckCustomDomains();
        stored = await helpCenterOf(ORG_A);
        expect(stored.customDomainFailures).toBe(0);
        expect(stored.customDomainVerifiedAt).toBeInstanceOf(Date);

        jest.restoreAllMocks();
        mockDns({});
        await helpCenterService.recheckCustomDomains();
        await helpCenterService.recheckCustomDomains();
        expect((await helpCenterOf(ORG_A)).customDomainVerifiedAt).toBeInstanceOf(Date);
        await helpCenterService.recheckCustomDomains();

        stored = await helpCenterOf(ORG_A);
        expect(stored.customDomainVerifiedAt).toBeNull();
        expect(stored.customDomain).toBe(CUSTOM_DOMAIN);
        // The cached "site" answer from above must be gone without help from the test.
        expect((await resolveHelpCenterHost(CUSTOM_DOMAIN)).kind).toBe("none");
        expect((await resolveHelpCenterHost("acme.help.test")).kind).toBe("site");
      });

      it("stops routing a domain whose CNAME now points at another help center", async () => {
        await verifiedDomain(ORG_A, adminA, CUSTOM_DOMAIN);
        mockDns({ cname: { [CUSTOM_DOMAIN]: [`${helpCenterB.customDomainTarget}.help.test`] } });
        for (let day = 0; day < 3; day++) await helpCenterService.recheckCustomDomains();
        expect((await helpCenterOf(ORG_A)).customDomainVerifiedAt).toBeNull();
        expect((await resolveHelpCenterHost(CUSTOM_DOMAIN)).kind).toBe("none");
      });

      it("can be verified again afterwards, starting from zero failures", async () => {
        await verifiedDomain(ORG_A, adminA, CUSTOM_DOMAIN);
        mockDns({});
        for (let day = 0; day < 3; day++) await helpCenterService.recheckCustomDomains();
        jest.restoreAllMocks();
        valid();

        await helpCenterService.verifyCustomDomain(ORG_A, actorOf(adminA));

        const stored = await helpCenterOf(ORG_A);
        expect(stored.customDomainVerifiedAt).toBeInstanceOf(Date);
        expect(stored.customDomainFailures).toBe(0);
        expect((await resolveHelpCenterHost(CUSTOM_DOMAIN)).kind).toBe("site");
      });

      it("leaves unverified domains alone", async () => {
        await helpCenterService.setCustomDomain(ORG_A, CUSTOM_DOMAIN, actorOf(adminA));
        const { cname } = mockDns({});
        await helpCenterService.recheckCustomDomains();
        expect(cname).not.toHaveBeenCalled();
        const stored = await helpCenterOf(ORG_A);
        expect(stored.customDomainFailures).toBe(0);
        expect(stored.customDomainCheckedAt).toBeNull();
      });
    });
  });

  describe("host resolver", () => {
    let helpCenterA: HelpCenter;

    beforeEach(async () => {
      helpCenterA = await createHelpCenter(ORG_A, "acme", adminA);
    });

    const idOf = async (hostname: string) => {
      const match = await resolveHelpCenterHost(hostname);
      return match.kind === "site" ? match.helpCenter.id : match.kind;
    };

    it("resolves a subdomain of the help center domain to its site, published or not", async () => {
      expect(await idOf("acme.help.test")).toBe(helpCenterA.id);
      await helpCenterService.setPublished(ORG_A, true, actorOf(adminA));
      const match = await resolveHelpCenterHost("acme.help.test");
      expect(match.kind === "site" && match.helpCenter.isPublished).toBe(true);
    });

    it("answers unknown for a label nobody has", async () => {
      expect(await idOf("nobody.help.test")).toBe("unknown");
    });

    it("answers unknown for nested labels and the apex", async () => {
      expect(await idOf("a.b.help.test")).toBe("unknown");
      expect(await idOf("acme.acme.help.test")).toBe("unknown");
      expect(await idOf("www.acme.help.test")).toBe("unknown");
      expect(await idOf("help.test")).toBe("unknown");
    });

    it("does not resolve the CNAME target label to a site", async () => {
      expect(await idOf(`${helpCenterA.customDomainTarget}.help.test`)).toBe("unknown");
    });

    it("answers none for hosts that are not help center hosts", async () => {
      expect(await idOf("example.test")).toBe("none");
      expect(await idOf("nothelp.test")).toBe("none");
      expect(await idOf("acme.help.test.evil.test")).toBe("none");
      expect(await idOf("")).toBe("none");
    });

    it("ignores an unverified custom domain and serves a verified one", async () => {
      await helpCenterService.setCustomDomain(ORG_A, CUSTOM_DOMAIN, actorOf(adminA));
      expect(await idOf(CUSTOM_DOMAIN)).toBe("none");
      await verifiedDomain(ORG_A, adminA, CUSTOM_DOMAIN);
      expect(await idOf(CUSTOM_DOMAIN)).toBe(helpCenterA.id);
      expect(await idOf(`www.${CUSTOM_DOMAIN}`)).toBe("none");
    });

    it("never gives the API or dashboard hostname to a help center", async () => {
      await createHelpCenter(ORG_B, "globex", adminB);
      const repository = AppDataSource.getRepository(HelpCenter);
      await repository.update(
        { organizationId: ORG_A },
        { customDomain: "api.hay-hc.test", customDomainVerifiedAt: new Date() },
      );
      await repository.update(
        { organizationId: ORG_B },
        { customDomain: "app.hay-hc.test", customDomainVerifiedAt: new Date() },
      );
      clearHelpCenterHostCache();

      expect(await idOf("api.hay-hc.test")).toBe("none");
      expect(await idOf("app.hay-hc.test")).toBe("none");
      expect(await idOf("API.Hay-HC.test.")).toBe("none");
    });

    it("matches hostnames in any case and with a trailing dot", async () => {
      await verifiedDomain(ORG_A, adminA, CUSTOM_DOMAIN);
      expect(await idOf("ACME.Help.Test")).toBe(helpCenterA.id);
      expect(await idOf("acme.help.test.")).toBe(helpCenterA.id);
      expect(await idOf("Acme.HELP.test.")).toBe(helpCenterA.id);
      expect(await idOf(CUSTOM_DOMAIN.toUpperCase())).toBe(helpCenterA.id);
      expect(await idOf(`${CUSTOM_DOMAIN}.`)).toBe(helpCenterA.id);
    });

    it("forgets a cached miss when a help center takes that address", async () => {
      expect(await idOf("globex.help.test")).toBe("unknown");
      const helpCenterB = await createHelpCenter(ORG_B, "globex", adminB);
      expect(await idOf("globex.help.test")).toBe(helpCenterB.id);
    });
  });

  describe("documents.update", () => {
    it("changes a document's visibility", async () => {
      const document = await createDocument(ORG_A, "Refunds");
      const caller = documentsRouter.createCaller(await ctxFor(adminA, ORG_A));

      await caller.update({ id: document.id, visibility: DocumentVisibility.PUBLIC });
      expect((await documentById(document.id)).visibility).toBe(DocumentVisibility.PUBLIC);

      await caller.update({ id: document.id, visibility: DocumentVisibility.PRIVATE });
      const stored = await documentById(document.id);
      expect(stored.visibility).toBe(DocumentVisibility.PRIVATE);
      expect(stored.title).toBe("Refunds");
      expect(stored.status).toBe(DocumentationStatus.PUBLISHED);
    });

    it("refuses a visibility that does not exist and another organization's document", async () => {
      const document = await createDocument(ORG_A, "Refunds");
      const caller = documentsRouter.createCaller(await ctxFor(adminA, ORG_A));
      expect(
        await codeOf(caller.update({ id: document.id, visibility: "everyone" as never })),
      ).toBe("BAD_REQUEST");

      const other = documentsRouter.createCaller(await ctxFor(adminB, ORG_B));
      await expect(
        other.update({ id: document.id, visibility: DocumentVisibility.PUBLIC }),
      ).rejects.toThrow();
      expect((await documentById(document.id)).visibility).toBe(DocumentVisibility.PRIVATE);
    });
  });

  describe("audit log", () => {
    it("records creating, publishing and the custom domain steps", async () => {
      const caller = await asAdminA();
      const created = await caller.create({
        name: "Acme",
        subdomain: "acme",
        defaultLanguage: "en" as LanguageCode,
      });
      await caller.setPublished({ published: true });
      await caller.setPublished({ published: false });
      await caller.setCustomDomain({ domain: CUSTOM_DOMAIN });
      // Setting the same domain again changes nothing and is not logged twice.
      await caller.setCustomDomain({ domain: CUSTOM_DOMAIN });
      mockDns({});
      expect(await codeOf(caller.verifyCustomDomain())).toBe("PRECONDITION_FAILED");
      jest.restoreAllMocks();
      const target = (await helpCenterOf(ORG_A)).customDomainTarget;
      mockDns({ cname: { [CUSTOM_DOMAIN]: [`${target}.help.test`] } });
      await caller.verifyCustomDomain();
      await caller.removeCustomDomain();

      expect(await auditActions(ORG_A)).toEqual([
        "help_center.create",
        "help_center.publish",
        "help_center.unpublish",
        "help_center.domain.set",
        "help_center.domain.verify",
        "help_center.domain.remove",
      ]);

      const rows = await AppDataSource.getRepository(AuditLog).find({
        where: { organizationId: ORG_A, resource: "help_center" },
        order: { createdAt: "ASC" },
      });
      expect(rows).toHaveLength(6);
      expect(rows.every((row) => row.userId === adminA.id)).toBe(true);
      expect(rows.every((row) => row.ipAddress === "203.0.113.20")).toBe(true);
      expect(rows[0].changes).toEqual({ subdomain: "acme" });
      expect(rows[3].changes).toEqual({ domain: CUSTOM_DOMAIN });
      expect(rows[4].changes).toEqual({ domain: CUSTOM_DOMAIN });
      expect(created.subdomain).toBe("acme");
    });

    it("records nothing for a refused create", async () => {
      const caller = await asAdminA();
      expect(
        await codeOf(
          caller.create({
            name: "Acme",
            subdomain: "www",
            defaultLanguage: "en" as LanguageCode,
          }),
        ),
      ).toBe("BAD_REQUEST");
      expect(await auditActions(ORG_A)).toEqual([]);
    });
  });
});
