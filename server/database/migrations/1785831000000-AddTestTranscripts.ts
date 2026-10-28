import { MigrationInterface, QueryRunner } from "typeorm";

/** D7-8: imported past conversations, in the neutral TestTranscript shape. */
export class AddTestTranscripts1785831000000 implements MigrationInterface {
  name = "AddTestTranscripts1785831000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "test_transcripts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "source" varchar(32) NOT NULL,
        "external_id" varchar(255),
        "title" varchar(255),
        "turns" jsonb NOT NULL,
        "order_ref" varchar(255),
        "turn_count" integer NOT NULL,
        "started_at" timestamptz,
        "import_batch_id" uuid NOT NULL,
        "created_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_test_transcripts" PRIMARY KEY ("id"),
        CONSTRAINT "fk_test_transcripts_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_test_transcripts_created_by" FOREIGN KEY ("created_by_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_test_transcripts_org_created"
        ON "test_transcripts" ("organization_id", "created_at");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_test_transcripts_org_batch"
        ON "test_transcripts" ("organization_id", "import_batch_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "test_transcripts"`);
  }
}
