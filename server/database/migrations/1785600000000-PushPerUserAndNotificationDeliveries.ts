import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D11-5 + D11-8.
 *
 * - `push_subscriptions` loses `organization_id`: a device belongs to its
 *   user, and alerts fan out to the devices of every active member, so a
 *   person in two organizations gets both organizations' alerts on one phone.
 * - `notification_deliveries`: one row per alert step per recipient for a
 *   conversation waiting for a human (initial push, re-push, email). The
 *   escalation sweep reads it to decide the next step, and the unique key
 *   makes each step claimable once, even with two sweeps running.
 */
export class PushPerUserAndNotificationDeliveries1785600000000 implements MigrationInterface {
  name = "PushPerUserAndNotificationDeliveries1785600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_push_subscriptions_organization";`);
    await queryRunner.query(`
      ALTER TABLE "push_subscriptions"
        DROP CONSTRAINT IF EXISTS "fk_push_subscriptions_organization",
        DROP COLUMN IF EXISTS "organization_id";
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_deliveries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "cycle_started_at" timestamptz NOT NULL,
        "step" varchar(16) NOT NULL,
        "channel" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL,
        "detail" text,
        "sent_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_notification_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "uq_notification_deliveries_step"
          UNIQUE ("conversation_id", "cycle_started_at", "step", "user_id"),
        CONSTRAINT "fk_notification_deliveries_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_notification_deliveries_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_notification_deliveries_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_deliveries_initial_cycle"
        ON "notification_deliveries" ("cycle_started_at")
        WHERE "step" = 'initial';
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_deliveries_org_created"
        ON "notification_deliveries" ("organization_id", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_deliveries";`);
    // Devices registered after `up` have no organization; they are dropped and
    // re-register on the next app open.
    await queryRunner.query(`DELETE FROM "push_subscriptions";`);
    await queryRunner.query(`
      ALTER TABLE "push_subscriptions"
        ADD COLUMN IF NOT EXISTS "organization_id" uuid NOT NULL,
        ADD CONSTRAINT "fk_push_subscriptions_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_organization"
        ON "push_subscriptions" ("organization_id");
    `);
  }
}
