import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Convert conversations.channel from Postgres enum to varchar(64).
 *
 * Motivation: channel plugins are added dynamically and should not require
 * a schema migration every time a new channel (e.g. "chatwoot") is introduced.
 * The enum approach coupled Hay core to a hardcoded list of channel names.
 *
 * After this migration, any string up to 64 chars is accepted as a channel
 * identifier. Validation is the responsibility of plugin registration and
 * API input schemas (which still enforce sensible bounds).
 */
export class ConvertConversationChannelToVarchar1781100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the default so the column can be retyped cleanly
    await queryRunner.query(`ALTER TABLE "conversations" ALTER COLUMN "channel" DROP DEFAULT`);

    // Convert enum column to varchar(64), casting existing values via ::text
    await queryRunner.query(
      `ALTER TABLE "conversations" ALTER COLUMN "channel" TYPE varchar(64) USING "channel"::text`,
    );

    // Reapply default
    await queryRunner.query(`ALTER TABLE "conversations" ALTER COLUMN "channel" SET DEFAULT 'web'`);

    // Drop the now-orphaned enum type
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."conversations_channel_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate the original enum type (matching ConsolidatedInitialSchema)
    await queryRunner.query(
      `CREATE TYPE "public"."conversations_channel_enum" AS ENUM('web', 'whatsapp', 'instagram', 'telegram', 'sms', 'email')`,
    );

    await queryRunner.query(`ALTER TABLE "conversations" ALTER COLUMN "channel" DROP DEFAULT`);

    // Any channel value not in the original enum would fail this cast;
    // the revert should only be run on a clean state.
    await queryRunner.query(
      `ALTER TABLE "conversations" ALTER COLUMN "channel" TYPE "public"."conversations_channel_enum" USING "channel"::text::"public"."conversations_channel_enum"`,
    );

    await queryRunner.query(`ALTER TABLE "conversations" ALTER COLUMN "channel" SET DEFAULT 'web'`);
  }
}
