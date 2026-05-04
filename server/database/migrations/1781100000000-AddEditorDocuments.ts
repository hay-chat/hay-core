import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEditorDocuments1781100000000 implements MigrationInterface {
  name = "AddEditorDocuments1781100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS content_json JSONB NULL
    `);

    const editorExists = await queryRunner.query(`
      SELECT 1 FROM pg_enum
      WHERE enumlabel = 'editor'
      AND enumtypid = 'documents_import_method_enum'::regtype
    `);

    if (!editorExists || editorExists.length === 0) {
      await queryRunner.query(`ALTER TYPE documents_import_method_enum ADD VALUE 'editor'`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE documents
      DROP COLUMN IF EXISTS content_json
    `);
    // Postgres cannot drop enum values without recreating the type; leave 'editor' in place.
  }
}
