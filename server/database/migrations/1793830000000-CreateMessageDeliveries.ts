import { MigrationInterface, QueryRunner } from "typeorm";

/** Durable record of outbound channel deliveries; claimed by one consumer at a time. */
export class CreateMessageDeliveries1793830000000 implements MigrationInterface {
  name = "CreateMessageDeliveries1793830000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "message_deliveries" (
        "id" uuid NOT NULL,
        "kind" varchar(20) NOT NULL,
        "organization_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
        "claimed_at" timestamptz,
        "last_error" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_message_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "fk_message_deliveries_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_message_deliveries_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_message_deliveries_due" ON "message_deliveries" ("next_attempt_at") WHERE "status" = 'pending'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_message_deliveries_claimed" ON "message_deliveries" ("claimed_at") WHERE "status" = 'processing'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_message_deliveries_conversation" ON "message_deliveries" ("conversation_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "message_deliveries"`);
  }
}
