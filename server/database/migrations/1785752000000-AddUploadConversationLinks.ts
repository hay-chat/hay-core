import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D8-3: link conversation media uploads to the conversation, message and
 * customer they belong to, so retention and GDPR erasure can delete the files
 * and an orphan sweep can find uploads no message uses.
 *
 * Message and conversation deletes set the link to NULL (not cascade): the row
 * must survive so the sweep can delete the stored file before the row.
 */
export class AddUploadConversationLinks1785752000000 implements MigrationInterface {
  name = "AddUploadConversationLinks1785752000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "uploads"
        ADD COLUMN IF NOT EXISTS "conversation_id" uuid,
        ADD COLUMN IF NOT EXISTS "message_id" uuid,
        ADD COLUMN IF NOT EXISTS "customer_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "uploads"
        ADD CONSTRAINT "fk_uploads_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "fk_uploads_message" FOREIGN KEY ("message_id")
          REFERENCES "messages"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "fk_uploads_customer" FOREIGN KEY ("customer_id")
          REFERENCES "customers"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_uploads_conversation_id" ON "uploads" ("conversation_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_uploads_customer_id" ON "uploads" ("customer_id")
    `);
    // Backfill from messages already carrying the upload (attachment id = upload
    // id), so the orphan sweep never mistakes existing media for orphans.
    await queryRunner.query(`
      UPDATE "uploads" u
      SET "message_id" = m."id",
          "conversation_id" = m."conversation_id",
          "customer_id" = c."customer_id"
      FROM "messages" m
      JOIN "conversations" c ON c."id" = m."conversation_id"
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(m."attachments") = 'array' THEN m."attachments" ELSE '[]'::jsonb END
      ) a
      WHERE u."folder" = 'conversation-media'
        AND u."message_id" IS NULL
        AND c."organization_id" = u."organization_id"
        AND a->>'id' = u."id"::text
    `);
    // The orphan and retention sweeps only ever look at conversation media.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_uploads_conversation_media_created"
        ON "uploads" ("created_at")
        WHERE "folder" = 'conversation-media'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_uploads_conversation_media_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_uploads_customer_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_uploads_conversation_id"`);
    await queryRunner.query(`
      ALTER TABLE "uploads"
        DROP CONSTRAINT IF EXISTS "fk_uploads_customer",
        DROP CONSTRAINT IF EXISTS "fk_uploads_message",
        DROP CONSTRAINT IF EXISTS "fk_uploads_conversation"
    `);
    await queryRunner.query(`
      ALTER TABLE "uploads"
        DROP COLUMN IF EXISTS "customer_id",
        DROP COLUMN IF EXISTS "message_id",
        DROP COLUMN IF EXISTS "conversation_id"
    `);
  }
}
