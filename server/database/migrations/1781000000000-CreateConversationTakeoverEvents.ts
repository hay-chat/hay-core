import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateConversationTakeoverEvents1781000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversation_takeover_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "started_at" timestamptz NOT NULL,
        "ended_at" timestamptz NULL,
        "duration_seconds" integer NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_takeover_events"
      ADD CONSTRAINT "fk_cte_conversation_id"
      FOREIGN KEY ("conversation_id")
      REFERENCES "conversations"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_takeover_events"
      ADD CONSTRAINT "fk_cte_user_id"
      FOREIGN KEY ("user_id")
      REFERENCES "users"("id")
      ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_cte_org_started_at"
      ON "conversation_takeover_events" ("organization_id", "started_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_cte_conversation_open"
      ON "conversation_takeover_events" ("conversation_id", "ended_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_cte_user_started_at"
      ON "conversation_takeover_events" ("user_id", "started_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_cte_user_started_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_cte_conversation_open"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_cte_org_started_at"`);

    await queryRunner.query(
      `ALTER TABLE "conversation_takeover_events" DROP CONSTRAINT IF EXISTS "fk_cte_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_takeover_events" DROP CONSTRAINT IF EXISTS "fk_cte_conversation_id"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "conversation_takeover_events"`);
  }
}

