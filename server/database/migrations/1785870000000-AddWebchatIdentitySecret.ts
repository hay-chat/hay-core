import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D1: per-organization secret the store's server uses to sign the webchat
 * `customerExternalId` (HMAC-SHA256). Stored encrypted (encryptValue);
 * generated the first time an admin reveals it, so there is no backfill.
 */
export class AddWebchatIdentitySecret1785870000000 implements MigrationInterface {
  name = "AddWebchatIdentitySecret1785870000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webchat_settings" ADD COLUMN IF NOT EXISTS "identity_secret" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webchat_settings" DROP COLUMN IF EXISTS "identity_secret"`,
    );
  }
}
