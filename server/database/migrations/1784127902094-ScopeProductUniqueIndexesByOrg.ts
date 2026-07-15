import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The unique indexes on products / product_variants were on (source,
 * external_id) only, which is global across organizations. Two orgs syncing
 * the same store (same plugin id + same external ids) collide: the second
 * org's sync fails every upsert with a duplicate-key error. The sync code
 * has always treated the idempotency key as per-org
 * (product-sync.service.ts looks up by organizationId + source +
 * externalId), so the index must include organization_id.
 */
export class ScopeProductUniqueIndexesByOrg1784127902094 implements MigrationInterface {
  name = "ScopeProductUniqueIndexesByOrg1784127902094";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_source_external_id"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_products_source_external_id"
       ON "products" ("organization_id", "source", "external_id")`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_variants_source_external_id"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_product_variants_source_external_id"
       ON "product_variants" ("organization_id", "source", "external_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_variants_source_external_id"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_product_variants_source_external_id"
       ON "product_variants" ("source", "external_id")`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_source_external_id"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_products_source_external_id"
       ON "products" ("source", "external_id")`,
    );
  }
}
