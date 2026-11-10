import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Multilingual inbox:
 * - cached translations of a conversation's title and hand-off summary, and of
 *   a team question's text, for team members who read in another language.
 *   Both columns are read and written only through raw SQL (the entities
 *   declare them `select/insert/update: false`), so entity loads keep working
 *   while this migration is pending.
 * - trigram indexes so the conversation search can match message text and its
 *   translations (`ILIKE '%term%'`) without scanning every message.
 *
 * Deploy note: `CREATE INDEX` on `messages` blocks writes to it while it
 * builds (TypeORM runs migrations in one transaction, so CONCURRENTLY is not
 * possible here). On a large table, create both indexes by hand first with
 * `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` (same definitions as below);
 * this migration then skips them.
 */
export class AddConversationAndTeamQuestionTranslations1794800001000 implements MigrationInterface {
  name = "AddConversationAndTeamQuestionTranslations1794800001000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "translations" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_questions" ADD COLUMN IF NOT EXISTS "translations" jsonb`,
    );
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_messages_content_trgm" ON "messages" USING gin ("content" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_messages_translations_trgm" ON "messages" USING gin (("translations"::text) gin_trgm_ops) WHERE "translations" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_messages_translations_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_messages_content_trgm"`);
    // pg_trgm stays installed: other objects may use it, and it is harmless.
    await queryRunner.query(`ALTER TABLE "team_questions" DROP COLUMN IF EXISTS "translations"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "translations"`);
  }
}
