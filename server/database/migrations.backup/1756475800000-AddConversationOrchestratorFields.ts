import { MigrationInterface, QueryRunner } from "typeorm";

export class AddConversationOrchestratorFields1756475800000 implements MigrationInterface {
  name = "AddConversationOrchestratorFields1756475800000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add conversation orchestrator fields
    await queryRunner.query(
      `CREATE TYPE "public"."conversations_status_enum" AS ENUM('open', 'pending-human', 'resolved')`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD "status" "public"."conversations_status_enum" NOT NULL DEFAULT 'open'`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD "cooldown_until" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD "last_user_message_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" ADD "ended_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "conversations" ADD "context" jsonb`);
    await queryRunner.query(`ALTER TABLE "conversations" ADD "resolution_metadata" jsonb`);

    // Make agent_id nullable
    // Drop existing foreign key if it exists
    await queryRunner.query(`
            DO $$ 
            BEGIN
                ALTER TABLE conversations DROP CONSTRAINT IF EXISTS "FK_6c3f11e6e1e1fb1c7f8c3f0b3b3b";
                ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_agent_id_fkey;
            END $$;
        `);
    await queryRunner.query(`ALTER TABLE "conversations" ALTER COLUMN "agent_id" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_conversations_agent" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Add message orchestrator fields
    await queryRunner.query(`ALTER TABLE "messages" ADD "sender" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "messages" ADD "metadata" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove message fields
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "metadata"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "sender"`);

    // Revert agent_id to non-nullable
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "FK_conversations_agent"`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" ALTER COLUMN "agent_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_conversations_agent" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // Remove conversation fields
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "resolution_metadata"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "context"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "ended_at"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "last_user_message_at"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "cooldown_until"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "public"."conversations_status_enum"`);
  }
}
