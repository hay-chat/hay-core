import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDocumentProcessingMetadata1764710000000 implements MigrationInterface {
  name = "AddDocumentProcessingMetadata1764710000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add processing_metadata JSONB column to documents table
    await queryRunner.query(`
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS processing_metadata JSONB NULL
    `);

    // Add index for querying by processing metadata
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_processing_retry
      ON documents USING gin(processing_metadata)
      WHERE processing_metadata IS NOT NULL
    `);

    // Add new enum values to documents_status_enum
    // Note: These must be added AFTER committing the column
    // Check if 'processing' value already exists
    const processingExists = await queryRunner.query(`
      SELECT 1 FROM pg_enum
      WHERE enumlabel = 'processing'
      AND enumtypid = 'documents_status_enum'::regtype
    `);

    if (!processingExists || processingExists.length === 0) {
      await queryRunner.query(`ALTER TYPE documents_status_enum ADD VALUE 'processing'`);
    }

    // Check if 'error' value already exists
    const errorExists = await queryRunner.query(`
      SELECT 1 FROM pg_enum
      WHERE enumlabel = 'error'
      AND enumtypid = 'documents_status_enum'::regtype
    `);

    if (!errorExists || errorExists.length === 0) {
      await queryRunner.query(`ALTER TYPE documents_status_enum ADD VALUE 'error'`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_documents_processing_retry
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_documents_status_processing
    `);

    // Drop processing_metadata column
    await queryRunner.query(`
      ALTER TABLE documents
      DROP COLUMN IF EXISTS processing_metadata
    `);

    // Note: Cannot remove enum values in PostgreSQL without recreating the type
    // This would require:
    // 1. Creating a new enum type without the values
    // 2. Updating all columns to use the new type
    // 3. Dropping the old type
    // 4. Renaming the new type
    // For safety, we'll leave the enum values in place on rollback
  }
}
