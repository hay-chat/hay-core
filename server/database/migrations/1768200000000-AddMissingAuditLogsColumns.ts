import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMissingAuditLogsColumns1768200000000 implements MigrationInterface {
  name = "AddMissingAuditLogsColumns1768200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if metadata column exists, add it if not
    const hasMetadata = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'audit_logs' AND column_name = 'metadata'
    `);

    if (hasMetadata.length === 0) {
      await queryRunner.query(`ALTER TABLE "audit_logs" ADD "metadata" jsonb`);
    }

    // Check if resource column exists, add it if not
    const hasResource = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'audit_logs' AND column_name = 'resource'
    `);

    if (hasResource.length === 0) {
      await queryRunner.query(`ALTER TABLE "audit_logs" ADD "resource" character varying(100)`);
    }

    // Check if changes column exists, add it if not
    const hasChanges = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'audit_logs' AND column_name = 'changes'
    `);

    if (hasChanges.length === 0) {
      await queryRunner.query(`ALTER TABLE "audit_logs" ADD "changes" jsonb`);
    }

    // Check if ip_address column exists, add it if not
    const hasIpAddress = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'audit_logs' AND column_name = 'ip_address'
    `);

    if (hasIpAddress.length === 0) {
      await queryRunner.query(`ALTER TABLE "audit_logs" ADD "ip_address" character varying(45)`);
    }

    // Check if user_agent column exists, add it if not
    const hasUserAgent = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'audit_logs' AND column_name = 'user_agent'
    `);

    if (hasUserAgent.length === 0) {
      await queryRunner.query(`ALTER TABLE "audit_logs" ADD "user_agent" character varying(500)`);
    }

    // Check if status column exists, add it if not
    const hasStatus = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'audit_logs' AND column_name = 'status'
    `);

    if (hasStatus.length === 0) {
      await queryRunner.query(`ALTER TABLE "audit_logs" ADD "status" character varying(100)`);
    }

    // Check if error_message column exists, add it if not
    const hasErrorMessage = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'audit_logs' AND column_name = 'error_message'
    `);

    if (hasErrorMessage.length === 0) {
      await queryRunner.query(`ALTER TABLE "audit_logs" ADD "error_message" text`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only drop columns if they exist
    const hasMetadata = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'audit_logs' AND column_name = 'metadata'
    `);
    if (hasMetadata.length > 0) {
      await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN "metadata"`);
    }
  }
}
