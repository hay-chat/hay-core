import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProcessingLock1756638500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add processing_locked_until field to conversations table to prevent duplicate processing
    await queryRunner.query(`
            ALTER TABLE "conversations" 
            ADD COLUMN "processing_locked_until" TIMESTAMPTZ
        `);

    // Add index for efficient queries on processing lock
    await queryRunner.query(`
            CREATE INDEX "IDX_conversations_processing_locked_until" 
            ON "conversations" ("processing_locked_until")
            WHERE "processing_locked_until" IS NOT NULL
        `);

    // Add processing_locked_by field to track which server instance has the lock
    await queryRunner.query(`
            ALTER TABLE "conversations" 
            ADD COLUMN "processing_locked_by" VARCHAR(255)
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the index
    await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_conversations_processing_locked_until"
        `);

    // Remove the columns
    await queryRunner.query(`
            ALTER TABLE "conversations" 
            DROP COLUMN IF EXISTS "processing_locked_until"
        `);

    await queryRunner.query(`
            ALTER TABLE "conversations" 
            DROP COLUMN IF EXISTS "processing_locked_by"
        `);
  }
}
