import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateHelpCenters1795000000000 implements MigrationInterface {
  name = "CreateHelpCenters1795000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "help_centers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" varchar,
        "updated_by" varchar,
        "metadata" jsonb,
        "organization_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "subdomain" varchar(63) NOT NULL,
        "default_language" varchar(10) NOT NULL DEFAULT 'en',
        "is_published" boolean NOT NULL DEFAULT false,
        "search_indexing" boolean NOT NULL DEFAULT true,
        "theme" jsonb NOT NULL DEFAULT '{}',
        "custom_domain" varchar(253),
        "custom_domain_target" varchar(63) NOT NULL,
        "custom_domain_verified_at" timestamptz,
        "custom_domain_checked_at" timestamptz,
        "custom_domain_failures" int NOT NULL DEFAULT 0,
        CONSTRAINT "pk_help_centers" PRIMARY KEY ("id"),
        CONSTRAINT "fk_help_centers_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_help_centers_organization" ON "help_centers" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_help_centers_subdomain" ON "help_centers" ("subdomain")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_help_centers_custom_domain_target" ON "help_centers" ("custom_domain_target")`,
    );
    // Only one help center can serve a domain; unproven claims never block the owner.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_help_centers_verified_custom_domain" ON "help_centers" ("custom_domain") WHERE "custom_domain_verified_at" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "help_center_collections" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" varchar,
        "updated_by" varchar,
        "metadata" jsonb,
        "organization_id" uuid NOT NULL,
        "help_center_id" uuid NOT NULL,
        "title" varchar(120) NOT NULL,
        "description" varchar(300),
        "icon" varchar(16),
        "position" int NOT NULL DEFAULT 0,
        CONSTRAINT "pk_help_center_collections" PRIMARY KEY ("id"),
        CONSTRAINT "fk_help_center_collections_help_center" FOREIGN KEY ("help_center_id") REFERENCES "help_centers"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_help_center_collections_help_center_position" ON "help_center_collections" ("help_center_id", "position")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "help_center_articles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" varchar,
        "updated_by" varchar,
        "metadata" jsonb,
        "organization_id" uuid NOT NULL,
        "collection_id" uuid NOT NULL,
        "document_id" uuid NOT NULL,
        "position" int NOT NULL DEFAULT 0,
        "helpful_count" int NOT NULL DEFAULT 0,
        "unhelpful_count" int NOT NULL DEFAULT 0,
        CONSTRAINT "pk_help_center_articles" PRIMARY KEY ("id"),
        CONSTRAINT "fk_help_center_articles_collection" FOREIGN KEY ("collection_id") REFERENCES "help_center_collections"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_help_center_articles_document" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_help_center_articles_document" ON "help_center_articles" ("document_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_help_center_articles_collection_position" ON "help_center_articles" ("collection_id", "position")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "help_center_articles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "help_center_collections"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "help_centers"`);
  }
}
