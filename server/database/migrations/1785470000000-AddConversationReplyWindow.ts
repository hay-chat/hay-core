import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D13-2: when the channel stops accepting free-form replies on a conversation
 * (WhatsApp's 24-hour customer service window). Set by the channel plugin on
 * each inbound message; null means the channel has no reply window.
 */
export class AddConversationReplyWindow1785470000000 implements MigrationInterface {
  name = "AddConversationReplyWindow1785470000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversations"
        ADD COLUMN IF NOT EXISTS "reply_window_expires_at" timestamptz;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversations" DROP COLUMN IF EXISTS "reply_window_expires_at";
    `);
  }
}
