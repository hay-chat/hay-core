import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * G3: operator events whose first delivery failed, retried with backoff.
 * No foreign key to organizations (the event reports a deleted organization).
 */
export class AddOperatorEvents1785895000000 implements MigrationInterface {
  name = "AddOperatorEvents1785895000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "operator_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "event" varchar(64) NOT NULL,
        "organization_id" uuid NOT NULL,
        "payload" jsonb NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz,
        "delivered_at" timestamptz,
        "failed_at" timestamptz,
        "last_error" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_operator_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_operator_events_due" ON "operator_events" ("next_attempt_at")
      WHERE "delivered_at" IS NULL AND "failed_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "operator_events"`);
  }
}
