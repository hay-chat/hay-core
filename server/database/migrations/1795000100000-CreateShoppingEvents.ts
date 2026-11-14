import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * `shopping_events`: clicks on recommended product cards and their buy links,
 * the funnel steps after a recommendation is shown.
 */
export class CreateShoppingEvents1795000100000 implements MigrationInterface {
  name = "CreateShoppingEvents1795000100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shopping_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "message_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "type" varchar(32) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_shopping_events" PRIMARY KEY ("id"),
        CONSTRAINT "fk_shopping_events_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_shopping_events_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_shopping_events_message" FOREIGN KEY ("message_id")
          REFERENCES "messages"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_shopping_events_org_created"
        ON "shopping_events" ("organization_id", "created_at");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_shopping_events_conversation"
        ON "shopping_events" ("conversation_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "shopping_events"`);
  }
}
