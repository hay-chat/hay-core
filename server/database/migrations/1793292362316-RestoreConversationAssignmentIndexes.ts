import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Restores the conversation assignment indexes (inbox "assigned to me" and
 * status filters). They were dropped by CreateAuditLogTable1759949698167 and
 * never re-created.
 */
export class RestoreConversationAssignmentIndexes1793292362316 implements MigrationInterface {
  name = "RestoreConversationAssignmentIndexes1793292362316";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_conversations_assigned_user_id" ON "conversations" ("assigned_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_conversations_status_assigned" ON "conversations" ("status", "assigned_user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_conversations_status_assigned"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_conversations_assigned_user_id"`);
  }
}
