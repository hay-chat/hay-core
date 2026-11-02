import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Document, DocumentationStatus } from "../../entities/document.entity";
import { DocumentSource } from "../../entities/document-source.entity";
import { SitePage } from "../../database/entities/site-page.entity";

const getSitemapEntries = jest.fn<(siteUrl: string) => Promise<Array<{ url: string }>>>();
jest.mock("../../services/web-scraper.service", () => ({
  WebScraperService: class {
    getSitemapEntries = getSitemapEntries;
  },
}));

import { siteIndexService } from "../../services/site-index.service";

describe("site index (find_page_url, link check)", () => {
  const orgId = "51e00000-0000-4000-8000-000000000001";
  const orgs = () => AppDataSource.getRepository(Organization);
  const pages = () => AppDataSource.getRepository(SitePage);

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    if (!(await orgs().findOne({ where: { id: orgId } }))) {
      await orgs().save(
        orgs().create({ id: orgId, name: "Vase Shop", slug: "vase-shop-site-index" }),
      );
    }
  });

  beforeEach(async () => {
    getSitemapEntries.mockReset();
    await pages().delete({ organizationId: orgId });
    await AppDataSource.getRepository(Document).delete({ organizationId: orgId });
    await AppDataSource.getRepository(DocumentSource).delete({ organizationId: orgId });
    await orgs().update({ id: orgId }, { website: null });
  });

  afterAll(async () => {
    await AppDataSource.getRepository(Document).delete({ organizationId: orgId });
    await AppDataSource.getRepository(DocumentSource).delete({ organizationId: orgId });
    await orgs().delete({ id: orgId });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("indexes the sitemap of the website, own host only, without duplicates", async () => {
    await orgs().update({ id: orgId }, { website: "https://vases.example" });
    getSitemapEntries.mockResolvedValue([
      { url: "https://vases.example/" },
      { url: "https://vases.example/pages/summer-sale" },
      { url: "https://www.vases.example/pages/summer-sale/" },
      { url: "https://cdn.other.example/x" },
    ]);

    expect(await siteIndexService.sync(orgId)).toBe(2);
    const rows = await pages().find({ where: { organizationId: orgId }, order: { url: "ASC" } });
    expect(rows.map((r) => [r.url, r.title])).toEqual([
      ["https://vases.example/", "home"],
      ["https://vases.example/pages/summer-sale", "pages summer sale"],
    ]);
  });

  it("falls back to the website document source and keeps pages when the sitemap fails", async () => {
    await AppDataSource.getRepository(DocumentSource).save({
      organizationId: orgId,
      pluginId: "core:website",
      sourceType: "website",
      displayName: "Website",
      config: { url: "https://vases.example" },
    });
    getSitemapEntries.mockResolvedValue([{ url: "https://vases.example/contact" }]);
    expect(await siteIndexService.sync(orgId)).toBe(1);

    getSitemapEntries.mockRejectedValue(new Error("timeout"));
    expect(await siteIndexService.sync(orgId)).toBeNull();
    expect(await pages().count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("finds pages by words, imported documents first, and lists known URLs", async () => {
    await orgs().update({ id: orgId }, { website: "https://vases.example" });
    getSitemapEntries.mockResolvedValue([
      { url: "https://vases.example/pages/summer-sale" },
      { url: "https://vases.example/pages/contact" },
      { url: "https://vases.example/policies/shipping-policy" },
    ]);
    await siteIndexService.sync(orgId);
    await AppDataSource.getRepository(Document).save({
      organizationId: orgId,
      title: "Shipping and returns",
      content: "We ship worldwide.",
      status: DocumentationStatus.PUBLISHED,
      sourceUrl: "https://vases.example/pages/shipping-returns",
    });

    const found = await siteIndexService.search(orgId, "shipping");
    expect(found[0]).toEqual({
      url: "https://vases.example/pages/shipping-returns",
      title: "Shipping and returns",
    });
    expect(found.map((p) => p.url)).toContain("https://vases.example/policies/shipping-policy");
    expect(await siteIndexService.search(orgId, "sale")).toEqual([
      { url: "https://vases.example/pages/summer-sale", title: "pages summer sale" },
    ]);
    expect(await siteIndexService.search(orgId, "warranty")).toEqual([]);

    const urls = await siteIndexService.listUrls(orgId);
    expect(urls).toHaveLength(4);
  });
});
