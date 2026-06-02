import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds the BaseEntity columns (created_by, updated_by, metadata) to
 * document_sources that the initial AddDocumentSources migration missed.
 * DocumentSource extends OrganizationScopedEntity → BaseEntity which declares
 * these columns; without them TypeORM queries fail with "column does not exist".
 */
export class AddDocumentSourcesBaseColumns1780396800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "document_sources"
      ADD COLUMN IF NOT EXISTS "created_by" varchar NULL,
      ADD COLUMN IF NOT EXISTS "updated_by" varchar NULL,
      ADD COLUMN IF NOT EXISTS "metadata" jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "document_sources"
      DROP COLUMN IF EXISTS "metadata",
      DROP COLUMN IF EXISTS "updated_by",
      DROP COLUMN IF EXISTS "created_by"
    `);
  }
}
