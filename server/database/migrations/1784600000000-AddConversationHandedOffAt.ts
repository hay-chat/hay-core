import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * When a conversation first went to a human (pending-human or
 * human-took-over). Kept after the chat is handed back to the AI, so billing
 * can tell a handed-back resolution from an AI-only one.
 *
 * Backfill from the traces that existed before this column: a takeover event,
 * a human-agent message, a handoff summary, or a current handoff status.
 */
export class AddConversationHandedOffAt1784600000000 implements MigrationInterface {
  name = "AddConversationHandedOffAt1784600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversations"
        ADD COLUMN IF NOT EXISTS "handed_off_at" timestamptz;
    `);

    await queryRunner.query(`
      UPDATE "conversations" c
      SET "handed_off_at" = COALESCE(
        (SELECT MIN(e."started_at") FROM "conversation_takeover_events" e
          WHERE e."conversation_id" = c."id"),
        (SELECT MIN(m."created_at") FROM "messages" m
          WHERE m."conversation_id" = c."id" AND m."type" = 'HumanAgent'),
        c."updated_at"
      )
      WHERE c."handed_off_at" IS NULL
        AND (
          c."summary" IS NOT NULL
          OR c."status" IN ('pending-human', 'human-took-over')
          OR EXISTS (SELECT 1 FROM "conversation_takeover_events" e
            WHERE e."conversation_id" = c."id")
          OR EXISTS (SELECT 1 FROM "messages" m
            WHERE m."conversation_id" = c."id" AND m."type" = 'HumanAgent')
        );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversations"
        DROP COLUMN IF EXISTS "handed_off_at";
    `);
  }
}
