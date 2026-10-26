import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Web Push subscriptions: one row per opted-in browser/device, scoped to the
 * user and the organization active at opt-in time. Used to alert agents on
 * their phone when a conversation needs a human.
 */
export class AddPushSubscriptions1784500000000 implements MigrationInterface {
  name = "AddPushSubscriptions1784500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "push_subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "endpoint" text NOT NULL,
        "p256dh" text NOT NULL,
        "auth" text NOT NULL,
        "user_agent" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_push_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_push_subscriptions_endpoint" UNIQUE ("endpoint"),
        CONSTRAINT "fk_push_subscriptions_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_push_subscriptions_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_user"
        ON "push_subscriptions" ("user_id");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_organization"
        ON "push_subscriptions" ("organization_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "push_subscriptions";`);
  }
}
