import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCustomerEntity1756581266486 implements MigrationInterface {
  name = "AddCustomerEntity1756581266486";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_9f32ead8384a1a92e073a7c006a"`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" DROP CONSTRAINT "FK_conversations_agent"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_messages_conversation_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_messages_type"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_conversations_agent_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_conversations_organization_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_conversations_playbook_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_conversations_needs_processing"`);
    await queryRunner.query(
      `CREATE TABLE "customers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "external_id" character varying(255), "email" character varying(255), "phone" character varying(50), "name" character varying(255), "notes" text, "external_metadata" jsonb, "organization_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_133ec679a801fab5e070f73d3ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fd8ff15d87714c6b6b955262c1" ON "customers" ("organization_id", "email") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e657a38782ca3690fa2fbf254b" ON "customers" ("organization_id", "external_id") `,
    );
    await queryRunner.query(`ALTER TABLE "conversations" ADD "customer_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "customers" ADD CONSTRAINT "FK_d2fc0e42b07d01fafc3fbb2bee3" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_9f32ead8384a1a92e073a7c006a" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_c9f0434c15cacf894e996f69088" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_c9f0434c15cacf894e996f69088"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_9f32ead8384a1a92e073a7c006a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" DROP CONSTRAINT "FK_d2fc0e42b07d01fafc3fbb2bee3"`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "customer_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e657a38782ca3690fa2fbf254b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fd8ff15d87714c6b6b955262c1"`);
    await queryRunner.query(`DROP TABLE "customers"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_conversations_needs_processing" ON "conversations" ("needs_processing") WHERE (needs_processing = true)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversations_playbook_id" ON "conversations" ("playbook_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversations_organization_id" ON "conversations" ("organization_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversations_agent_id" ON "conversations" ("agent_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_messages_type" ON "messages" ("type") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_conversation_id" ON "messages" ("conversation_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_conversations_agent" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_9f32ead8384a1a92e073a7c006a" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
