import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Provider-side delivery status for outbound messages (e.g. Meta WhatsApp
 * sent/delivered/read/failed). Kept separate from `delivery_state`, which is
 * the test-mode approval gate.
 */
export class AddMessageProviderStatus1784400000000 implements MigrationInterface {
  name = "AddMessageProviderStatus1784400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "messages"
        ADD COLUMN IF NOT EXISTS "provider_status" varchar(20),
        ADD COLUMN IF NOT EXISTS "provider_error" jsonb;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_messages_provider_message_id"
        ON "messages" ("provider_message_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_messages_provider_message_id";`);
    await queryRunner.query(`
      ALTER TABLE "messages"
        DROP COLUMN IF EXISTS "provider_status",
        DROP COLUMN IF EXISTS "provider_error";
    `);
  }
}
