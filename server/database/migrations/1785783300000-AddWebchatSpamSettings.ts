import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D9-6 / D9-7: owner controls for the webchat spam detector.
 * - `spam_classifier_enabled`: also ask an easy-tier model about conversations
 *   the heuristics find suspicious but not conclusive. Off by default.
 * - `spam_guidance`: owner notes fed to that classifier ("we never get
 *   messages about SEO", "B2B leads are welcome").
 */
export class AddWebchatSpamSettings1785783300000 implements MigrationInterface {
  name = "AddWebchatSpamSettings1785783300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        ADD COLUMN IF NOT EXISTS "spam_classifier_enabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "spam_guidance" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        DROP COLUMN IF EXISTS "spam_guidance",
        DROP COLUMN IF EXISTS "spam_classifier_enabled"
    `);
  }
}
