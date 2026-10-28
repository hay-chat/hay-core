import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Product, ProductStatus } from "../../entities/product.entity";
import { ProductVariant } from "../../entities/product-variant.entity";
import { productSyncService } from "../../services/product-sync.service";

/**
 * H1: after a complete catalogue sync a plugin prunes the products the store
 * no longer returns. Only that plugin's products go; other sources and other
 * orgs are untouched; variants cascade.
 */
describe("productSyncService.pruneProducts (H1)", () => {
  const orgId = "4a100000-0000-4000-8000-000000000001";
  const otherOrgId = "4a100000-0000-4000-8000-000000000002";
  const products = () => AppDataSource.getRepository(Product);

  async function seed(organizationId: string, source: string, externalId: string) {
    const product = await products().save(
      products().create({
        organizationId,
        source,
        externalId,
        handle: `h-${externalId}`,
        title: `Product ${externalId}`,
        status: ProductStatus.ACTIVE,
        tags: [],
        available: true,
      }),
    );
    await AppDataSource.getRepository(ProductVariant).save({
      organizationId,
      productId: product.id,
      externalId: `${externalId}::default`,
      source,
      title: "Default",
      inventoryTracked: false,
    });
    return product;
  }

  const externalIds = async (organizationId: string, source: string) =>
    (await products().find({ where: { organizationId, source } })).map((p) => p.externalId).sort();

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgRepo = AppDataSource.getRepository(Organization);
    for (const [id, slug] of [
      [orgId, "prune-org"],
      [otherOrgId, "prune-other-org"],
    ]) {
      if (!(await orgRepo.findOne({ where: { id } }))) {
        await orgRepo.save(orgRepo.create({ id, name: slug, slug }));
      }
    }
  });

  beforeEach(async () => {
    await products().delete({ organizationId: orgId });
    await products().delete({ organizationId: otherOrgId });
  });

  afterAll(async () => {
    await products().delete({ organizationId: orgId });
    await products().delete({ organizationId: otherOrgId });
  });

  it("removes only this source's products the store no longer returned", async () => {
    await seed(orgId, "hay-plugin-shop", "1");
    const gone = await seed(orgId, "hay-plugin-shop", "2");
    await seed(orgId, "hay-plugin-shop", "3");
    await seed(orgId, "manual", "2");
    await seed(otherOrgId, "hay-plugin-shop", "2");

    const result = await productSyncService.pruneProducts(orgId, "hay-plugin-shop", ["1", "3"]);

    expect(result).toEqual({ removed: 1 });
    expect(await externalIds(orgId, "hay-plugin-shop")).toEqual(["1", "3"]);
    expect(await externalIds(orgId, "manual")).toEqual(["2"]);
    expect(await externalIds(otherOrgId, "hay-plugin-shop")).toEqual(["2"]);
    expect(
      await AppDataSource.getRepository(ProductVariant).count({ where: { productId: gone.id } }),
    ).toBe(0);
  });

  it("is a no-op when everything is still in the store", async () => {
    await seed(orgId, "hay-plugin-shop", "1");
    expect(await productSyncService.pruneProducts(orgId, "hay-plugin-shop", ["1", "9"])).toEqual({
      removed: 0,
    });
    expect(await externalIds(orgId, "hay-plugin-shop")).toEqual(["1"]);
  });

  it("refuses an empty keep list so a failed listing cannot wipe the catalogue", async () => {
    await seed(orgId, "hay-plugin-shop", "1");
    await expect(productSyncService.pruneProducts(orgId, "hay-plugin-shop", [])).rejects.toThrow();
    expect(await externalIds(orgId, "hay-plugin-shop")).toEqual(["1"]);
  });
});
