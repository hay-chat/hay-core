import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMetadataToAuditLogs1729695100000 implements MigrationInterface {
  name = "AddMetadataToAuditLogs1729695100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add metadata column to audit_logs table
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      ADD COLUMN "metadata" JSONB
    `);

    // Add comment explaining the field
    await queryRunner.query(`
      COMMENT ON COLUMN "audit_logs"."metadata" IS 'Additional metadata for the audit log entry (e.g., export expiration dates, request details)';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove metadata column
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      DROP COLUMN "metadata"
    `);
  }
}
