import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the products + product_variants + product_embeddings tables for the
 * presales product-recommendations feature.
 *
 * Mirrors the documents/embeddings layout: an entity-backed product catalog
 * with a sibling raw-SQL embeddings table holding pgvector(1536) values and
 * an HNSW cosine index.
 *
 * Idempotency: UNIQUE (source, external_id) on both products and
 * product_variants so adapters can `INSERT ... ON CONFLICT DO UPDATE`.
 */
export class CreateProductTables1782000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // -------- products --------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "products" (
        "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"    uuid NOT NULL,
        "external_id"        text NOT NULL,
        "source"             text NOT NULL,
        "handle"             text NOT NULL,
        "title"              text NOT NULL,
        "description"        text NULL,
        "description_short"  text NULL,
        "vendor"             text NULL,
        "product_type"       text NULL,
        "status"             text NOT NULL DEFAULT 'active',
        "tags"               text[] NOT NULL DEFAULT '{}',
        "categories"         jsonb NULL,
        "options"            jsonb NULL,
        "images"             jsonb NULL,
        "currency"           char(3) NULL,
        "price_min"          numeric(12,2) NULL,
        "price_max"          numeric(12,2) NULL,
        "available"          boolean NOT NULL DEFAULT false,
        "search_text"        text NULL,
        "attributes"         jsonb NULL,
        "source_url"         text NULL,
        "metadata"           jsonb NULL,
        "created_by"         varchar NULL,
        "updated_by"         varchar NULL,
        "created_at"         timestamptz NOT NULL DEFAULT now(),
        "updated_at"         timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "products"
      ADD CONSTRAINT "fk_products_organization_id"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_products_organization_id" ON "products" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_products_handle" ON "products" ("handle")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_products_external_id" ON "products" ("external_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_products_price_min" ON "products" ("price_min")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_products_available" ON "products" ("available")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_products_source_external_id" ON "products" ("source", "external_id")`,
    );
    // GIN indexes for jsonb / array searches the recommendation tool uses.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_products_tags_gin" ON "products" USING gin ("tags")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_products_categories_gin" ON "products" USING gin ("categories")`,
    );

    // -------- product_variants --------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_variants" (
        "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"     uuid NOT NULL,
        "product_id"          uuid NOT NULL,
        "external_id"         text NOT NULL,
        "source"              text NOT NULL,
        "sku"                 text NULL,
        "barcode"             text NULL,
        "title"               text NOT NULL,
        "selected_options"    jsonb NULL,
        "position"            integer NULL,
        "price"               numeric(12,2) NULL,
        "compare_at_price"    numeric(12,2) NULL,
        "currency"            char(3) NULL,
        "inventory_quantity"  integer NULL,
        "inventory_tracked"   boolean NOT NULL DEFAULT false,
        "availability"        text NOT NULL DEFAULT 'in_stock',
        "weight_value"        numeric(12,3) NULL,
        "weight_unit"         text NULL,
        "image_src"           text NULL,
        "attributes"          jsonb NULL,
        "metadata"            jsonb NULL,
        "created_by"          varchar NULL,
        "updated_by"          varchar NULL,
        "created_at"          timestamptz NOT NULL DEFAULT now(),
        "updated_at"          timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "product_variants"
      ADD CONSTRAINT "fk_product_variants_product_id"
      FOREIGN KEY ("product_id") REFERENCES "products"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "product_variants"
      ADD CONSTRAINT "fk_product_variants_organization_id"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_product_variants_organization_id" ON "product_variants" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_product_variants_product_id" ON "product_variants" ("product_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_product_variants_sku" ON "product_variants" ("sku")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_product_variants_price" ON "product_variants" ("price")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_product_variants_availability" ON "product_variants" ("availability")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_product_variants_source_external_id" ON "product_variants" ("source", "external_id")`,
    );

    // -------- product_embeddings --------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_embeddings" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"  uuid NOT NULL,
        "product_id"       uuid NOT NULL,
        "page_content"     text NOT NULL,
        "metadata"         jsonb NULL,
        "embedding"        vector(1536) NULL,
        "created_at"       timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "product_embeddings"
      ADD CONSTRAINT "fk_product_embeddings_organization_id"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "product_embeddings"
      ADD CONSTRAINT "fk_product_embeddings_product_id"
      FOREIGN KEY ("product_id") REFERENCES "products"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "product_embeddings_org_id_idx" ON "product_embeddings" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "product_embeddings_product_id_idx" ON "product_embeddings" ("product_id")`,
    );

    // HNSW build memory tuning — matches embeddings HNSW migration.
    await queryRunner.query(`SET LOCAL max_parallel_maintenance_workers = 0`);
    await queryRunner.query(`SET LOCAL maintenance_work_mem = '1GB'`);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "product_embeddings_embedding_hnsw_idx" ON "product_embeddings" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "product_embeddings_embedding_hnsw_idx"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "product_embeddings_product_id_idx"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "product_embeddings_org_id_idx"`);
    await queryRunner.query(
      `ALTER TABLE "product_embeddings" DROP CONSTRAINT IF EXISTS "fk_product_embeddings_product_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_embeddings" DROP CONSTRAINT IF EXISTS "fk_product_embeddings_organization_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "product_embeddings"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_variants_source_external_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_variants_availability"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_variants_price"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_variants_sku"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_variants_product_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_variants_organization_id"`);
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP CONSTRAINT IF EXISTS "fk_product_variants_organization_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP CONSTRAINT IF EXISTS "fk_product_variants_product_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "product_variants"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_categories_gin"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_tags_gin"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_source_external_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_available"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_price_min"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_external_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_handle"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_organization_id"`);
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "fk_products_organization_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "products"`);
  }
}
