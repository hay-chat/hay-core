import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D19-1: `team_questions`, the quick check with the team. One row per fact the
 * AI asked the team about without handing the conversation off. At most one
 * open question per conversation (partial unique index).
 */
export class AddTeamQuestions1785930000000 implements MigrationInterface {
  name = "AddTeamQuestions1785930000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "team_questions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "question" text NOT NULL,
        "customer_message" text,
        "language" varchar(16),
        "status" varchar(16) NOT NULL DEFAULT 'open',
        "asked_at" timestamptz NOT NULL,
        "update_sent_at" timestamptz,
        "timed_out_at" timestamptz,
        "answered_by" uuid,
        "answer" text,
        "answered_at" timestamptz,
        "delivered_at" timestamptz,
        "relay_mode" varchar(16),
        "save_to_knowledge" boolean NOT NULL DEFAULT true,
        "closed_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_team_questions" PRIMARY KEY ("id"),
        CONSTRAINT "fk_team_questions_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_team_questions_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_team_questions_answered_by" FOREIGN KEY ("answered_by")
          REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_team_questions_closed_by" FOREIGN KEY ("closed_by")
          REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "chk_team_questions_status"
          CHECK ("status" IN ('open', 'timed_out', 'answered', 'dismissed', 'cancelled'))
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_team_questions_org_status"
        ON "team_questions" ("organization_id", "status");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_team_questions_conversation"
        ON "team_questions" ("conversation_id");
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_team_questions_one_open"
        ON "team_questions" ("conversation_id") WHERE "status" = 'open';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "team_questions"`);
  }
}
