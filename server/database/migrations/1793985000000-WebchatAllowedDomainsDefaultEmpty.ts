import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * New webchat settings start with no allowed domains. Existing rows keep
 * whatever they hold.
 */
export class WebchatAllowedDomainsDefaultEmpty1793985000000 implements MigrationInterface {
  name = "WebchatAllowedDomainsDefaultEmpty1793985000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webchat_settings" ALTER COLUMN "allowed_domains" SET DEFAULT '{}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webchat_settings" ALTER COLUMN "allowed_domains" SET DEFAULT ARRAY['*']`,
    );
  }
}
