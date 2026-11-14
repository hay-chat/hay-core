import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Pages imported by website document sources only stored their address in
 * external_url, so the agent didn't cite them, the site index skipped them and
 * the docs audit saw no URL structure. Sync now writes source_url too; this
 * fills it in for pages imported before that.
 */
export class BackfillWebsiteSourceDocumentUrls1794800002000 implements MigrationInterface {
  name = "BackfillWebsiteSourceDocumentUrls1794800002000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "documents" d
      SET "source_url" = d."external_url"
      FROM "document_sources" s
      WHERE d."document_source_id" = s."id"
        AND s."plugin_id" = 'core:website'
        AND d."source_url" IS NULL
        AND d."external_url" IS NOT NULL
    `);
  }

  public async down(): Promise<void> {
    // Nothing to undo: sync writes source_url for these pages anyway.
  }
}
