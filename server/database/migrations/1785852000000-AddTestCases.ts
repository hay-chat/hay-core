import { MigrationInterface, QueryRunner } from "typeorm";

/** D7-12: saved test cases, run before a playbook draft is published. */
export class AddTestCases1785852000000 implements MigrationInterface {
  name = "AddTestCases1785852000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "test_cases" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "title" varchar(255) NOT NULL,
        "seed" jsonb NOT NULL,
        "expectations" jsonb NOT NULL DEFAULT '{}',
        "source" varchar(32) NOT NULL,
        "source_ref" varchar(255),
        "playbook_id" uuid,
        "created_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_test_cases" PRIMARY KEY ("id"),
        CONSTRAINT "fk_test_cases_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_test_cases_playbook" FOREIGN KEY ("playbook_id")
          REFERENCES "playbooks"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_test_cases_created_by" FOREIGN KEY ("created_by_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_test_cases_org_created"
        ON "test_cases" ("organization_id", "created_at");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_test_cases_org_playbook"
        ON "test_cases" ("organization_id", "playbook_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "test_cases"`);
  }
}
