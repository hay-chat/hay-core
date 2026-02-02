import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDataRetentionFields1768400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add data retention columns to conversations
    await queryRunner.query(`
      ALTER TABLE "conversations"
      ADD COLUMN "deleted_at" timestamptz NULL,
      ADD COLUMN "legal_hold" boolean NOT NULL DEFAULT false,
      ADD COLUMN "legal_hold_set_at" timestamptz NULL
    `);

    // Add index for efficient cleanup queries (find non-anonymized conversations by org)
    await queryRunner.query(`
      CREATE INDEX "idx_conversations_retention_cleanup"
      ON "conversations"("organization_id", "deleted_at")
      WHERE "deleted_at" IS NULL
    `);

    // Add index for legal hold filtering
    await queryRunner.query(`
      CREATE INDEX "idx_conversations_legal_hold"
      ON "conversations"("organization_id", "legal_hold")
      WHERE "legal_hold" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_conversations_legal_hold"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_conversations_retention_cleanup"
    `);

    // Drop columns
    await queryRunner.query(`
      ALTER TABLE "conversations"
      DROP COLUMN IF EXISTS "deleted_at",
      DROP COLUMN IF EXISTS "legal_hold",
      DROP COLUMN IF EXISTS "legal_hold_set_at"
    `);
  }
}
