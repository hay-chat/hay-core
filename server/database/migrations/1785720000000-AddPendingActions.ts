import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D4-3: `pending_actions`, write tool calls held for human approval.
 * Status moves forward only (pending -> approved -> executed|failed, or
 * pending -> rejected|expired); the idempotency key is unique.
 */
export class AddPendingActions1785720000000 implements MigrationInterface {
  name = "AddPendingActions1785720000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pending_actions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "message_id" uuid,
        "plugin_id" varchar(255),
        "tool_name" varchar(255) NOT NULL,
        "category" varchar(32) NOT NULL,
        "args" jsonb NOT NULL DEFAULT '{}',
        "amount" numeric(14,2),
        "hold_reason" varchar(32) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "idempotency_key" varchar(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "decided_by" uuid,
        "decided_at" timestamptz,
        "decision_note" text,
        "error_code" varchar(32),
        "executed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_pending_actions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_pending_actions_idempotency_key" UNIQUE ("idempotency_key"),
        CONSTRAINT "chk_pending_actions_status" CHECK (
          "status" IN ('pending', 'approved', 'executed', 'failed', 'rejected', 'expired')
        ),
        CONSTRAINT "fk_pending_actions_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pending_actions_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pending_actions_decided_by" FOREIGN KEY ("decided_by")
          REFERENCES "users"("id") ON DELETE SET NULL
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pending_actions_org_status"
        ON "pending_actions" ("organization_id", "status");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pending_actions_conversation"
        ON "pending_actions" ("conversation_id");
    `);
    // The expiry sweep only ever looks at pending rows.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pending_actions_pending_expiry"
        ON "pending_actions" ("expires_at")
        WHERE "status" = 'pending';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pending_actions";`);
  }
}
