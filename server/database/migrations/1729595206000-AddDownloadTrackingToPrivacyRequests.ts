import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDownloadTrackingToPrivacyRequests1729595206000 implements MigrationInterface {
  name = "AddDownloadTrackingToPrivacyRequests1729595206000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add download tracking fields to privacy_requests table
    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      ADD COLUMN "download_ip_address" VARCHAR(45),
      ADD COLUMN "downloaded_at" TIMESTAMPTZ,
      ADD COLUMN "download_count" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN "max_downloads" INTEGER NOT NULL DEFAULT 1
    `);

    // Add comment explaining the fields
    await queryRunner.query(`
      COMMENT ON COLUMN "privacy_requests"."download_ip_address" IS 'IP address used for first download (for security validation)';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "privacy_requests"."downloaded_at" IS 'Timestamp of first download';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "privacy_requests"."download_count" IS 'Number of times the export has been downloaded';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "privacy_requests"."max_downloads" IS 'Maximum number of allowed downloads (configurable, default 1 for single-use)';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove download tracking fields
    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      DROP COLUMN "max_downloads",
      DROP COLUMN "download_count",
      DROP COLUMN "downloaded_at",
      DROP COLUMN "download_ip_address"
    `);
  }
}
