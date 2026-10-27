import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D6-5: `action_log`, one row per tool call (success, error, simulated, held),
 * with redacted args and a tool-errors code. Outputs are not stored.
 */
export class AddActionLog1785710000000 implements MigrationInterface {
  name = "AddActionLog1785710000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "action_log" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "message_id" uuid,
        "plugin_id" varchar(255),
        "tool_name" varchar(255) NOT NULL,
        "category" varchar(32),
        "read_only" boolean NOT NULL,
        "args" jsonb NOT NULL DEFAULT '{}',
        "outcome" varchar(16) NOT NULL,
        "error_code" varchar(32),
        "duration_ms" integer NOT NULL DEFAULT 0,
        "idempotency_key" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_action_log" PRIMARY KEY ("id"),
        CONSTRAINT "fk_action_log_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_action_log_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_action_log_org_created"
        ON "action_log" ("organization_id", "created_at");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_action_log_conversation"
        ON "action_log" ("conversation_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "action_log";`);
  }
}
