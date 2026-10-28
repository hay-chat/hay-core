import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D2-4: `order_conversation_links`, which conversations talked about which
 * order. Written when a plugin tool call names an order (input or output) and
 * when a message mentions an order number. `plugin_id` is the plugin that
 * named the order (null for a number found in message text). `order_key` is
 * the platform's order id when known, else the order number; `order_label` is
 * the human order number ("1001" for "#1001"). One row per conversation,
 * plugin and order. Rows go with their conversation (cascade), so the pack
 * never outlives the org's retention.
 */
export class AddOrderConversationLinks1785762000000 implements MigrationInterface {
  name = "AddOrderConversationLinks1785762000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_conversation_links" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "message_id" uuid,
        "plugin_id" varchar(255),
        "order_key" varchar(64) NOT NULL,
        "order_label" varchar(64),
        "source" varchar(16) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_order_conversation_links" PRIMARY KEY ("id"),
        CONSTRAINT "chk_order_conversation_links_source" CHECK (
          "source" IN ('tool_input', 'tool_output', 'message_text')
        ),
        CONSTRAINT "fk_order_conversation_links_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_order_conversation_links_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_order_conversation_links_order"
        ON "order_conversation_links" (
          "conversation_id", COALESCE("plugin_id", ''), "order_key", COALESCE("order_label", '')
        );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_order_conversation_links_org_key"
        ON "order_conversation_links" ("organization_id", "order_key");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_order_conversation_links_org_label"
        ON "order_conversation_links" ("organization_id", "order_label");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_order_conversation_links_conversation"
        ON "order_conversation_links" ("conversation_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_conversation_links"`);
  }
}
