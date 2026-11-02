import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * `site_pages`: the organization's website pages, from its sitemap. Used by
 * the find_page_url tool and the link check on AI replies.
 */
export class AddSitePages1793300000000 implements MigrationInterface {
  name = "AddSitePages1793300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "site_pages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "url" varchar(2048) NOT NULL,
        "title" varchar(500) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_site_pages" PRIMARY KEY ("id"),
        CONSTRAINT "fk_site_pages_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_site_pages_org_url"
        ON "site_pages" ("organization_id", "url");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "site_pages"`);
  }
}
