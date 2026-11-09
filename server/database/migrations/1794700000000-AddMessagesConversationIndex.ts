import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMessagesConversationIndex1794700000000 implements MigrationInterface {
  name = "AddMessagesConversationIndex1794700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_messages_conversation_created" ON "messages" ("conversation_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_messages_conversation_created"`);
  }
}
