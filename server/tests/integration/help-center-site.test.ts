/**
 * The public help center website against a real database: what is public and
 * what is not, which hosts are served, preview, redirects, feedback, and the
 * response headers.
 */
process.env.HELP_CENTER_DOMAIN = "hc.test";
process.env.API_DOMAIN = "api.hay.test";
process.env.DASHBOARD_DOMAIN = "app.hay.test";
// One trusted proxy, so each test picks its visitor address with X-Forwarded-For.
process.env.TRUST_PROXY = "1";

import "reflect-metadata";
import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from "@jest/globals";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";

const mockCounters = new Map<string, number>();
jest.mock("../../services/rate-limit.service", () => ({
  rateLimitService: {
    checkKeyRateLimit: async (key: string, max: number) => {
      const count = (mockCounters.get(key) ?? 0) + 1;
      mockCounters.set(key, count);
      return { limited: count > max, remaining: Math.max(0, max - count), resetAt: new Date() };
    },
  },
}));

import { AppDataSource } from "../../database/data-source";
import { HelpCenter } from "../../database/entities/help-center.entity";
import { HelpCenterArticle } from "../../database/entities/help-center-article.entity";
import { HelpCenterCollection } from "../../database/entities/help-center-collection.entity";
import {
  Document,
  DocumentationStatus,
  DocumentVisibility,
  ImportMethod,
} from "../../entities/document.entity";
import { Organization } from "../../entities/organization.entity";
import { helpCenterSite, helpCenterTlsAskHandler } from "../../routes/help-center-site";
import { signPreviewToken } from "../../services/help-center/help-center.service";
import { clearHelpCenterHostCache } from "../../services/help-center/host-resolver";
import { SITE_CSS_PATH } from "../../services/help-center/render/styles";
import { webchatSettingsService } from "../../services/webchat/webchat-settings.service";

const ORG_ID = "4c000000-0000-4000-8000-0000000000a1";
const OTHER_ORG_ID = "4c000000-0000-4000-8000-0000000000b2";
const HELP_CENTER_ID = "4c000000-0000-4000-8000-0000000000c1";
const OTHER_HELP_CENTER_ID = "4c000000-0000-4000-8000-0000000000c2";
const COLLECTION_ID = "c0110001-0000-4000-8000-000000000001";
const DRAFTS_COLLECTION_ID = "c0110002-0000-4000-8000-000000000002";
const OTHER_COLLECTION_ID = "c0110003-0000-4000-8000-000000000003";

const HOST = "acme-hc-test.hc.test";
const OTHER_HOST = "other-hc-test.hc.test";
const API_HOST = "api.hay.test";

/** Every document's title and text contain this word, so search would find each of them. */
const WORD = "zebracorn";

const DOCS = {
  visible: { id: "d0c00001-0000-4000-8000-000000000001", title: `Reset your ${WORD} password` },
  editor: { id: "d0c00002-0000-4000-8000-000000000002", title: `Editor ${WORD} guide` },
  draft: { id: "d0c00003-0000-4000-8000-000000000003", title: `Draft ${WORD} notes` },
  private: { id: "d0c00004-0000-4000-8000-000000000004", title: `Private ${WORD} runbook` },
  archived: { id: "d0c00005-0000-4000-8000-000000000005", title: `Archived ${WORD} policy` },
  unassigned: { id: "d0c00006-0000-4000-8000-000000000006", title: `Unassigned ${WORD} faq` },
  other: { id: "d0c00007-0000-4000-8000-000000000007", title: `Other company ${WORD} pricing` },
};
const HIDDEN = [DOCS.draft, DOCS.private, DOCS.archived, DOCS.unassigned, DOCS.other];
const VISIBLE_PATH = `/articles/reset-your-${WORD}-password-d0c00001`;

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let port = 0;

function request(
  host: string,
  path: string,
  options: { method?: string; ip?: string; json?: unknown; rawBody?: string } = {},
): Promise<Reply> {
  const payload = options.rawBody ?? (options.json ? JSON.stringify(options.json) : undefined);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: {
          host,
          "x-forwarded-for": options.ip ?? "198.51.100.1",
          ...(payload ? { "content-type": "application/json" } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function cleanup(): Promise<void> {
  const organizations = [ORG_ID, OTHER_ORG_ID];
  for (const table of [
    "help_center_articles",
    "help_center_collections",
    "help_centers",
    "documents",
    "webchat_settings",
  ]) {
    await AppDataSource.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
      organizations,
    ]);
  }
  await AppDataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [organizations]);
}

async function updateHelpCenter(id: string, changes: Partial<HelpCenter>): Promise<void> {
  await AppDataSource.getRepository(HelpCenter).update({ id }, changes);
  clearHelpCenterHostCache();
}

async function counts(documentId: string): Promise<{ helpful: number; unhelpful: number }> {
  const article = await AppDataSource.getRepository(HelpCenterArticle).findOneOrFail({
    where: { documentId },
  });
  return { helpful: article.helpfulCount, unhelpful: article.unhelpfulCount };
}

async function seed(): Promise<void> {
  const organizations = AppDataSource.getRepository(Organization);
  await organizations.save(
    organizations.create({ id: ORG_ID, name: "Acme", slug: "acme-hc-test" }),
  );
  await organizations.save(
    organizations.create({ id: OTHER_ORG_ID, name: "Other", slug: "other-hc-test" }),
  );

  const helpCenters = AppDataSource.getRepository(HelpCenter);
  await helpCenters.save(
    helpCenters.create({
      id: HELP_CENTER_ID,
      organizationId: ORG_ID,
      name: "Acme Help",
      subdomain: "acme-hc-test",
      defaultLanguage: "en",
      isPublished: true,
      searchIndexing: true,
      // "list" puts every article title on the home page.
      theme: { layout: "list" },
      customDomainTarget: "hc-test-acme-target",
    }),
  );
  await helpCenters.save(
    helpCenters.create({
      id: OTHER_HELP_CENTER_ID,
      organizationId: OTHER_ORG_ID,
      name: "Other Help",
      subdomain: "other-hc-test",
      isPublished: true,
      theme: { layout: "list" },
      customDomainTarget: "hc-test-other-target",
    }),
  );

  const collections = AppDataSource.getRepository(HelpCenterCollection);
  await collections.save([
    collections.create({
      id: COLLECTION_ID,
      organizationId: ORG_ID,
      helpCenterId: HELP_CENTER_ID,
      title: "Getting started",
      position: 0,
    }),
    collections.create({
      id: DRAFTS_COLLECTION_ID,
      organizationId: ORG_ID,
      helpCenterId: HELP_CENTER_ID,
      title: "Nothing public here",
      position: 1,
    }),
    collections.create({
      id: OTHER_COLLECTION_ID,
      organizationId: OTHER_ORG_ID,
      helpCenterId: OTHER_HELP_CENTER_ID,
      title: "Other collection",
      position: 0,
    }),
  ]);

  const documents = AppDataSource.getRepository(Document);
  const document = (doc: { id: string; title: string }, fields: Partial<Document> = {}): Document =>
    documents.create({
      id: doc.id,
      organizationId: ORG_ID,
      title: doc.title,
      description: `About ${doc.title}`,
      content: `Some ${WORD} text for ${doc.title}.`,
      status: DocumentationStatus.PUBLISHED,
      visibility: DocumentVisibility.PUBLIC,
      importMethod: ImportMethod.UPLOAD,
      ...fields,
    });
  await documents.save([
    document(DOCS.visible, {
      content: `# Steps\n\nUse the **${WORD}** link.\n\n<script>alert("md")</script>\n\n[bad](javascript:alert(1))`,
    }),
    document(DOCS.editor, {
      importMethod: ImportMethod.EDITOR,
      content: `<p>The ${WORD} editor body <img src="https://img.example/a.png" onerror="alert(1)"></p><script>alert("html")</script>`,
    }),
    document(DOCS.draft, { status: DocumentationStatus.DRAFT }),
    document(DOCS.private, { visibility: DocumentVisibility.PRIVATE }),
    document(DOCS.archived, { status: DocumentationStatus.ARCHIVED }),
    document(DOCS.unassigned),
    document(DOCS.other, { organizationId: OTHER_ORG_ID }),
  ]);

  const articles = AppDataSource.getRepository(HelpCenterArticle);
  const place = (documentId: string, collectionId: string, position: number, org = ORG_ID) =>
    articles.create({ organizationId: org, documentId, collectionId, position });
  await articles.save([
    place(DOCS.visible.id, COLLECTION_ID, 0),
    place(DOCS.editor.id, COLLECTION_ID, 1),
    place(DOCS.private.id, COLLECTION_ID, 2),
    place(DOCS.archived.id, COLLECTION_ID, 3),
    place(DOCS.draft.id, DRAFTS_COLLECTION_ID, 0),
    place(DOCS.other.id, OTHER_COLLECTION_ID, 0, OTHER_ORG_ID),
  ]);
  clearHelpCenterHostCache();
}

describe("help center site", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    await cleanup();
    await seed();

    const app = express();
    app.set("trust proxy", 1);
    app.use(helpCenterSite());
    app.get("/internal/help-center/tls-ask", (req, res, next) => {
      helpCenterTlsAskHandler(req, res).catch(next);
    });
    app.use((_req, res) => {
      res.json({ reached: "api" });
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => mockCounters.clear());

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await cleanup();
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  describe("what is public", () => {
    it("shows published, public, assigned articles on the home page and nothing else", async () => {
      const home = await request(HOST, "/");
      expect(home.status).toBe(200);
      expect(home.body).toContain("Acme Help");
      expect(home.body).toContain(DOCS.visible.title);
      expect(home.body).toContain(DOCS.editor.title);
      expect(home.body).toContain(`href="${VISIBLE_PATH}"`);
      expect(home.body).toContain("Getting started");
      for (const hidden of HIDDEN) expect(home.body).not.toContain(hidden.title);
      // A collection without a visible article is not shown at all.
      expect(home.body).not.toContain("Nothing public here");
    });

    it("counts only visible articles on a collection card", async () => {
      await updateHelpCenter(HELP_CENTER_ID, { theme: { layout: "cards" } });
      try {
        const home = await request(HOST, "/");
        expect(home.body).toContain("2 articles");
        expect(home.body).toContain('href="/collections/getting-started-c0110001"');
        expect(home.body).not.toContain(DOCS.visible.title);
        expect(home.body).not.toContain("Nothing public here");
      } finally {
        await updateHelpCenter(HELP_CENTER_ID, { theme: { layout: "list" } });
      }
    });

    it("lists only visible articles on the collection page, and hides an empty collection", async () => {
      const page = await request(HOST, "/collections/getting-started-c0110001");
      expect(page.status).toBe(200);
      expect(page.body).toContain(DOCS.visible.title);
      expect(page.body.indexOf(DOCS.visible.title)).toBeLessThan(
        page.body.indexOf(DOCS.editor.title),
      );
      for (const hidden of HIDDEN) expect(page.body).not.toContain(hidden.title);

      expect((await request(HOST, "/collections/nothing-public-here-c0110002")).status).toBe(404);
      // Another organization's collection is not on this host.
      expect((await request(HOST, "/collections/other-collection-c0110003")).status).toBe(404);
    });

    it("finds only visible articles in search", async () => {
      const results = await request(HOST, `/search?q=${WORD}`);
      expect(results.status).toBe(200);
      expect(results.body).toContain(DOCS.visible.title);
      expect(results.body).toContain(DOCS.editor.title);
      for (const hidden of HIDDEN) expect(results.body).not.toContain(hidden.title);
      expect(results.body).toContain('content="noindex"');

      const byContent = await request(HOST, "/search?q=editor+body");
      expect(byContent.body).toContain(DOCS.editor.title);
      expect(byContent.body).not.toContain(DOCS.visible.title);
    });

    it("treats wildcard characters in a search as plain text", async () => {
      for (const query of ["%25", "_", "%25%25", "%5C"]) {
        const results = await request(HOST, `/search?q=${query}`);
        expect(results.status).toBe(200);
        expect(results.body).toContain("No results");
        expect(results.body).not.toContain(WORD);
      }
      const empty = await request(HOST, "/search");
      expect(empty.status).toBe(200);
      expect(empty.body).not.toContain(WORD);
    });

    it("lists only visible articles in the sitemap", async () => {
      const sitemap = await request(HOST, "/sitemap.xml");
      expect(sitemap.status).toBe(200);
      expect(sitemap.headers["content-type"]).toContain("application/xml");
      expect(sitemap.body).toContain(`<loc>http://${HOST}/</loc>`);
      expect(sitemap.body).toContain(`<loc>http://${HOST}${VISIBLE_PATH}</loc>`);
      expect(sitemap.body).toContain(
        `<loc>http://${HOST}/collections/getting-started-c0110001</loc>`,
      );
      expect(sitemap.body.match(/<url>/g)).toHaveLength(4);
      for (const hidden of HIDDEN) expect(sitemap.body).not.toContain(hidden.id.slice(0, 8));
      expect(sitemap.body).not.toContain("c0110002");
    });

    it("answers 404 at the address of every article that is not public", async () => {
      for (const hidden of HIDDEN) {
        const id8 = hidden.id.slice(0, 8);
        for (const path of [`/articles/${id8}`, `/articles/some-title-${id8}`]) {
          const page = await request(HOST, path);
          expect(page.status).toBe(404);
          expect(page.body).toContain("Page not found");
          expect(page.body).not.toContain(hidden.title);
        }
      }
    });

    it("serves another organization's article only on that organization's host", async () => {
      const path = `/articles/other-company-${WORD}-pricing-d0c00007`;
      expect((await request(HOST, path)).status).toBe(404);
      const own = await request(OTHER_HOST, path);
      expect(own.status).toBe(200);
      expect(own.body).toContain(DOCS.other.title);
      expect((await request(OTHER_HOST, VISIBLE_PATH)).status).toBe(404);
    });
  });

  describe("an article page", () => {
    it("renders markdown and drops scripts", async () => {
      const page = await request(HOST, VISIBLE_PATH);
      expect(page.status).toBe(200);
      expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(page.body).toContain(`<strong>${WORD}</strong>`);
      expect(page.body).toContain(`<link rel="canonical" href="http://${HOST}${VISIBLE_PATH}"`);
      expect(page.body).toContain(`content="About ${DOCS.visible.title}"`);
      expect(page.body).toContain("Getting started");
      expect(page.body).toContain("Was this helpful?");
      expect(page.body).not.toContain('alert("md")');
      expect(page.body).not.toContain("javascript:");
      expect(page.body).not.toContain('name="robots"');
    });

    it("sanitises editor HTML again on the way out", async () => {
      const page = await request(HOST, `/articles/editor-${WORD}-guide-d0c00002`);
      expect(page.status).toBe(200);
      expect(page.body).toContain(`The ${WORD} editor body`);
      expect(page.body).toContain('<img src="https://img.example/a.png"');
      expect(page.body).not.toContain("onerror");
      expect(page.body).not.toContain('alert("html")');
    });

    it("sends a nonce-based policy that matches the page and forbids framing", async () => {
      const page = await request(HOST, VISIBLE_PATH);
      const policy = String(page.headers["content-security-policy"]);
      const nonce = /script-src 'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
      expect(nonce).toBeTruthy();
      expect(page.body).toContain(`<script nonce="${nonce}">`);
      expect(page.body.match(/<script/g)?.length).toBe(
        page.body.match(/<script\s+nonce="/g)?.length,
      );
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain("base-uri 'none'");
      expect(policy).toContain("form-action 'self'");
      // Web chat is on by default, so the widget's host is allowed.
      expect(policy).toContain(`script-src 'nonce-${nonce}' http://${API_HOST}`);
      expect(policy).toContain(`connect-src 'self' http://${API_HOST} ws://${API_HOST}`);
      expect(policy).toContain(`frame-src http://${API_HOST}`);
      expect(page.body).toContain(`src="http://${API_HOST}/v1/webchat/widget.js"`);
      expect(page.body).toContain(ORG_ID);
      expect(page.body).toContain("Still need help?");

      expect(page.headers["x-content-type-options"]).toBe("nosniff");
      expect(page.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(page.headers["cache-control"]).toBe("public, max-age=60");

      const again = await request(HOST, VISIBLE_PATH);
      expect(String(again.headers["content-security-policy"])).not.toContain(`'nonce-${nonce}'`);
    });

    it("redirects an old or missing slug to the current address", async () => {
      for (const stale of ["/articles/an-old-title-d0c00001", "/articles/d0c00001"]) {
        const reply = await request(HOST, stale);
        expect(reply.status).toBe(301);
        expect(reply.headers.location).toBe(VISIBLE_PATH);
      }
      const collection = await request(HOST, "/collections/c0110001");
      expect(collection.status).toBe(301);
      expect(collection.headers.location).toBe("/collections/getting-started-c0110001");
    });
  });

  describe("hosts", () => {
    it("never reaches the API on a help center host", async () => {
      for (const path of ["/v1/health", "/health", "/uploads/x.png", "/sso/login", "/ready"]) {
        const reply = await request(HOST, path);
        expect(reply.status).toBe(404);
        expect(reply.headers["content-type"]).toContain("text/html");
        expect(reply.body).toContain("Page not found");
        expect(reply.body).not.toContain("reached");
      }
      const post = await request(HOST, "/v1/auth.login", { method: "POST", json: { a: 1 } });
      expect(post.status).toBe(405);
      expect(post.body).not.toContain("reached");
      expect((await request(HOST, "/", { method: "DELETE" })).status).toBe(405);
      // The certificate question is for the reverse proxy, on the API host only.
      const ask = await request(HOST, `/internal/help-center/tls-ask?domain=${HOST}`);
      expect(ask.status).toBe(404);
      expect(ask.body).toContain("Page not found");
    });

    it("leaves requests for the API host alone", async () => {
      const reply = await request(API_HOST, "/v1/health");
      expect(reply.status).toBe(200);
      expect(JSON.parse(reply.body)).toEqual({ reached: "api" });
      expect(reply.headers["content-security-policy"]).toBeUndefined();
      const post = await request("localhost", "/v1/anything", { method: "POST", json: {} });
      expect(JSON.parse(post.body)).toEqual({ reached: "api" });
    });

    it("answers 404 for an unknown subdomain, the bare domain and deeper names", async () => {
      for (const host of ["nobody-here.hc.test", "hc.test", `deep.${HOST}`]) {
        for (const path of ["/", "/v1/health", VISIBLE_PATH]) {
          const reply = await request(host, path);
          expect(reply.status).toBe(404);
          expect(reply.body).toContain("Page not found");
          expect(reply.body).not.toContain("Acme");
          expect(reply.body).not.toContain("reached");
          expect(reply.body).toContain('content="noindex"');
          expect(String(reply.headers["content-security-policy"])).toContain(
            "frame-ancestors 'none'",
          );
        }
        expect((await request(host, "/robots.txt")).body).toBe("User-agent: *\nDisallow: /\n");
      }
    });

    it("serves the stylesheet with a permanent cache, on any help center host", async () => {
      for (const host of [HOST, "nobody-here.hc.test"]) {
        const css = await request(host, SITE_CSS_PATH);
        expect(css.status).toBe(200);
        expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
        expect(css.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
        expect(css.body).toContain("--hc-bg");
      }
      expect((await request(HOST, "/_hc/site.000000000000.css")).status).toBe(404);
    });

    it("answers the proxy's certificate question", async () => {
      const ask = (domain: string) =>
        request(API_HOST, `/internal/help-center/tls-ask?domain=${encodeURIComponent(domain)}`);
      expect((await ask(HOST)).status).toBe(200);
      expect((await ask(HOST.toUpperCase())).status).toBe(200);
      for (const domain of ["nobody-here.hc.test", "hc.test", "example.com", API_HOST, ""]) {
        expect((await ask(domain)).status).toBe(404);
      }
      expect((await request(API_HOST, "/internal/help-center/tls-ask")).status).toBe(404);
    });

    it("serves a verified custom domain and makes it the canonical address", async () => {
      await updateHelpCenter(HELP_CENTER_ID, { customDomain: "help.acme-hc.example" });
      try {
        // Claimed but not verified: not served.
        expect(JSON.parse((await request("help.acme-hc.example", "/")).body)).toEqual({
          reached: "api",
        });
        await updateHelpCenter(HELP_CENTER_ID, { customDomainVerifiedAt: new Date() });
        const home = await request("help.acme-hc.example", "/");
        expect(home.status).toBe(200);
        expect(home.body).toContain('<link rel="canonical" href="http://help.acme-hc.example/"');
        expect((await request("help.acme-hc.example", "/v1/health")).status).toBe(404);
        // The built-in address keeps working and points at the custom one.
        expect((await request(HOST, "/")).body).toContain(
          '<link rel="canonical" href="http://help.acme-hc.example/"',
        );
        expect(await webchatSettingsService.isDomainAllowed(ORG_ID, "help.acme-hc.example")).toBe(
          true,
        );
      } finally {
        await updateHelpCenter(HELP_CENTER_ID, {
          customDomain: null,
          customDomainVerifiedAt: null,
        });
      }
    });

    it("rate limits per visitor address", async () => {
      mockCounters.set("help-center:site:ip:203.0.113.77", 300);
      const limited = await request(HOST, "/", { ip: "203.0.113.77" });
      expect(limited.status).toBe(429);
      expect(limited.headers["retry-after"]).toBe("60");
      expect((await request(HOST, "/", { ip: "203.0.113.78" })).status).toBe(200);

      mockCounters.set("help-center:search:ip:203.0.113.78", 30);
      expect((await request(HOST, `/search?q=${WORD}`, { ip: "203.0.113.78" })).status).toBe(429);
      expect((await request(HOST, "/", { ip: "203.0.113.78" })).status).toBe(200);
    });

    it("ignores an X-Forwarded-For entry the client added itself", async () => {
      mockCounters.set("help-center:site:ip:203.0.113.90", 300);
      // The proxy appends the real peer last; only that entry counts.
      expect((await request(HOST, "/", { ip: "203.0.113.90, 198.51.100.200" })).status).toBe(200);
      expect((await request(HOST, "/", { ip: "198.51.100.200, 203.0.113.90" })).status).toBe(429);
    });
  });

  describe("robots.txt", () => {
    it("allows crawling and names the sitemap when the site may be indexed", async () => {
      const robots = await request(HOST, "/robots.txt");
      expect(robots.status).toBe(200);
      expect(robots.headers["content-type"]).toBe("text/plain; charset=utf-8");
      expect(robots.body).toContain("Allow: /");
      expect(robots.body).toContain(`Sitemap: http://${HOST}/sitemap.xml`);
    });

    it("keeps crawlers out when indexing is off, on every page too", async () => {
      await updateHelpCenter(HELP_CENTER_ID, { searchIndexing: false });
      try {
        expect((await request(HOST, "/robots.txt")).body).toBe("User-agent: *\nDisallow: /\n");
        expect((await request(HOST, "/sitemap.xml")).status).toBe(404);
        for (const path of ["/", VISIBLE_PATH, "/collections/getting-started-c0110001"]) {
          const page = await request(HOST, path);
          expect(page.status).toBe(200);
          expect(page.body).toContain('<meta name="robots" content="noindex"');
        }
      } finally {
        await updateHelpCenter(HELP_CENTER_ID, { searchIndexing: true });
      }
    });
  });

  describe("an offline site and its preview", () => {
    beforeAll(() => updateHelpCenter(HELP_CENTER_ID, { isPublished: false }));
    afterAll(() => updateHelpCenter(HELP_CENTER_ID, { isPublished: true }));

    const encodeTheme = (theme: unknown) =>
      Buffer.from(JSON.stringify(theme)).toString("base64url");

    it("answers 404 everywhere and keeps crawlers out", async () => {
      for (const path of ["/", VISIBLE_PATH, `/search?q=${WORD}`, "/sitemap.xml"]) {
        const reply = await request(HOST, path);
        expect(reply.status).toBe(404);
        expect(reply.body).not.toContain("Acme");
        expect(reply.body).not.toContain(WORD);
      }
      expect((await request(HOST, "/robots.txt")).body).toBe("User-agent: *\nDisallow: /\n");
      // The other organization's site is unaffected.
      expect((await request(OTHER_HOST, "/")).status).toBe(200);
    });

    it("renders with a valid preview token, framed by the dashboard only", async () => {
      const token = signPreviewToken(HELP_CENTER_ID);
      const query = `hc_preview=${encodeURIComponent(token)}`;
      const home = await request(HOST, `/?${query}`);
      expect(home.status).toBe(200);
      expect(home.body).toContain(DOCS.visible.title);
      for (const hidden of HIDDEN) expect(home.body).not.toContain(hidden.title);
      expect(home.headers["cache-control"]).toBe("no-store");
      expect(String(home.headers["content-security-policy"])).toContain(
        "frame-ancestors http://app.hay.test",
      );
      expect(home.body).toContain('<meta name="robots" content="noindex"');
      // Navigation stays in preview.
      expect(home.body).toContain(`href="${VISIBLE_PATH}?${query.replace(/&/g, "&amp;")}"`);
      expect(home.body).toContain(`name="hc_preview" value="${token}"`);

      const article = await request(HOST, `${VISIBLE_PATH}?${query}`);
      expect(article.status).toBe(200);
      expect(article.body).toMatch(/<section[^>]*data-hc-preview/);
      const stale = await request(HOST, `/articles/d0c00001?${query}`);
      expect(stale.status).toBe(302);
      expect(stale.headers.location).toBe(`${VISIBLE_PATH}?${query}`);
      expect((await request(HOST, `/search?q=${WORD}&${query}`)).body).toContain(
        DOCS.visible.title,
      );
      // Preview shows what visitors would see: still nothing that is not public.
      expect((await request(HOST, `/articles/d0c00003?${query}`)).status).toBe(404);
    });

    it("answers 404 for an expired, forged or foreign token", async () => {
      const expired = signPreviewToken(HELP_CENTER_ID, Date.now() - 2 * 60 * 60 * 1000);
      const valid = signPreviewToken(HELP_CENTER_ID);
      const [expires, signature] = valid.split(".");
      const forged = [
        expired,
        `${Number(expires) + 60}.${signature}`,
        `${expires}.${signature.slice(0, -2)}AA`,
        signPreviewToken(OTHER_HELP_CENTER_ID),
        "1",
        "",
      ];
      for (const token of forged) {
        const reply = await request(HOST, `/?hc_preview=${encodeURIComponent(token)}`);
        expect(reply.status).toBe(404);
        expect(reply.body).not.toContain("Acme");
        expect(String(reply.headers["content-security-policy"])).toContain(
          "frame-ancestors 'none'",
        );
      }
      expect((await request(HOST, `/?hc_preview=${valid}&hc_preview=${valid}`)).status).toBe(200);
    });

    it("applies a valid theme from the preview link and ignores an invalid one", async () => {
      const query = `hc_preview=${encodeURIComponent(signPreviewToken(HELP_CENTER_ID))}`;
      const themed = await request(
        HOST,
        `/?${query}&hc_theme=${encodeTheme({ accentColor: "#ff0000", heroTitle: "Previewed <title>" })}`,
      );
      expect(themed.status).toBe(200);
      expect(themed.body).toContain("--hc-accent:#ff0000");
      expect(themed.body).toContain("Previewed &lt;title&gt;");
      expect(themed.body).toContain("&amp;hc_theme=");
      // The saved layout still applies: the patch is merged over it.
      expect(themed.body).toContain(DOCS.visible.title);

      for (const bad of [
        encodeTheme({ accentColor: "red;}</style><script>alert(1)</script>" }),
        encodeTheme({ font: "comic" }),
        encodeTheme("nope"),
        "%%%",
      ]) {
        const reply = await request(HOST, `/?${query}&hc_theme=${bad}`);
        expect(reply.status).toBe(200);
        expect(reply.body).toContain("--hc-accent:#2747d6");
        expect(reply.body).not.toContain("alert(1)");
        expect(reply.body).not.toContain("hc_theme");
      }
    });

    it("does not count feedback", async () => {
      const before = await counts(DOCS.visible.id);
      const reply = await request(HOST, "/_hc/feedback", {
        method: "POST",
        json: { articleId: DOCS.visible.id, helpful: true },
      });
      expect(reply.status).toBe(204);
      expect(await counts(DOCS.visible.id)).toEqual(before);
    });
  });

  it("ignores preview parameters without a valid token on a live site", async () => {
    const theme = Buffer.from(JSON.stringify({ accentColor: "#ff0000" })).toString("base64url");
    const home = await request(HOST, `/?hc_preview=1.forged&hc_theme=${theme}`);
    expect(home.status).toBe(200);
    expect(home.body).toContain("--hc-accent:#2747d6");
    expect(home.body).not.toContain("hc_preview");
    expect(home.headers["cache-control"]).toBe("public, max-age=60");
    expect(String(home.headers["content-security-policy"])).toContain("frame-ancestors 'none'");
  });

  it("answers 404 for a suspended organization, preview or not", async () => {
    const organizations = AppDataSource.getRepository(Organization);
    await organizations.update({ id: ORG_ID }, { suspendedAt: new Date() });
    try {
      const token = encodeURIComponent(signPreviewToken(HELP_CENTER_ID));
      for (const path of ["/", VISIBLE_PATH, `/?hc_preview=${token}`, "/sitemap.xml"]) {
        const reply = await request(HOST, path);
        expect(reply.status).toBe(404);
        expect(reply.body).not.toContain("Acme");
      }
      expect((await request(HOST, "/robots.txt")).body).toBe("User-agent: *\nDisallow: /\n");
      const before = await counts(DOCS.visible.id);
      await request(HOST, "/_hc/feedback", {
        method: "POST",
        json: { articleId: DOCS.visible.id, helpful: true },
      });
      expect(await counts(DOCS.visible.id)).toEqual(before);
    } finally {
      await organizations.update({ id: ORG_ID }, { suspendedAt: null });
    }
  });

  describe("feedback", () => {
    const vote = (articleId: unknown, helpful: unknown, ip: string, host = HOST) =>
      request(host, "/_hc/feedback", { method: "POST", ip, json: { articleId, helpful } });

    it("counts one answer per visitor address per article", async () => {
      const before = await counts(DOCS.visible.id);
      expect((await vote(DOCS.visible.id, true, "203.0.113.5")).status).toBe(204);
      expect((await vote(DOCS.visible.id, true, "203.0.113.5")).status).toBe(204);
      expect((await vote(DOCS.visible.id, false, "203.0.113.5")).status).toBe(204);
      // The id8 is the same article, so the same single answer.
      expect((await vote("d0c00001", true, "203.0.113.5")).status).toBe(204);
      expect(await counts(DOCS.visible.id)).toEqual({ ...before, helpful: before.helpful + 1 });

      await vote("d0c00001", false, "203.0.113.6");
      expect(await counts(DOCS.visible.id)).toEqual({
        helpful: before.helpful + 1,
        unhelpful: before.unhelpful + 1,
      });

      // Another article is a separate answer.
      const editorBefore = await counts(DOCS.editor.id);
      await vote(DOCS.editor.id, true, "203.0.113.5");
      expect((await counts(DOCS.editor.id)).helpful).toBe(editorBefore.helpful + 1);
    });

    it("changes nothing for articles that are not public or not on this host", async () => {
      for (const hidden of [DOCS.draft, DOCS.private, DOCS.archived, DOCS.other]) {
        const before = await counts(hidden.id);
        expect((await vote(hidden.id, true, "203.0.113.7")).status).toBe(204);
        expect(await counts(hidden.id)).toEqual(before);
      }
      expect((await vote(DOCS.unassigned.id, true, "203.0.113.7")).status).toBe(204);
    });

    it("answers 204 to anything malformed without counting it", async () => {
      const before = await counts(DOCS.visible.id);
      const ip = "203.0.113.8";
      expect((await vote("' OR 1=1 --", true, ip)).status).toBe(204);
      expect((await vote(DOCS.visible.id, "yes", ip)).status).toBe(204);
      expect((await vote(null, true, ip)).status).toBe(204);
      const broken = await request(HOST, "/_hc/feedback", {
        method: "POST",
        ip,
        rawBody: "{not json",
      });
      expect(broken.status).toBe(204);
      const huge = await request(HOST, "/_hc/feedback", {
        method: "POST",
        ip,
        rawBody: JSON.stringify({
          articleId: DOCS.visible.id,
          helpful: true,
          pad: "x".repeat(5000),
        }),
      });
      expect(huge.status).toBe(204);
      expect((await vote(DOCS.visible.id, true, ip, "nobody-here.hc.test")).status).toBe(204);
      expect(await counts(DOCS.visible.id)).toEqual(before);
      expect((await request(HOST, "/_hc/feedback")).status).toBe(404);
    });
  });

  describe("the chat widget on the help center", () => {
    it("is allowed on the organization's own help center host only", async () => {
      expect(await webchatSettingsService.isDomainAllowed(ORG_ID, HOST)).toBe(true);
      expect(await webchatSettingsService.isDomainAllowed(ORG_ID, HOST.toUpperCase())).toBe(true);
      expect(await webchatSettingsService.isDomainAllowed(ORG_ID, OTHER_HOST)).toBe(false);
      expect(await webchatSettingsService.isDomainAllowed(ORG_ID, "evil.example")).toBe(false);
      expect(await webchatSettingsService.isDomainAllowed(ORG_ID, null)).toBe(false);
    });

    it("is left off the page, and out of the policy, when web chat is disabled", async () => {
      await webchatSettingsService.updateSettings(ORG_ID, { isEnabled: false });
      try {
        const page = await request(HOST, VISIBLE_PATH);
        expect(page.status).toBe(200);
        expect(page.body).not.toContain("widget.js");
        expect(page.body).not.toContain("Still need help?");
        const policy = String(page.headers["content-security-policy"]);
        expect(policy).not.toContain("frame-src");
        expect(policy).toMatch(/script-src 'nonce-[^' ]+';/);
        expect(policy).toContain("connect-src 'self';");
      } finally {
        await webchatSettingsService.updateSettings(ORG_ID, { isEnabled: true });
      }
    });
  });
});
