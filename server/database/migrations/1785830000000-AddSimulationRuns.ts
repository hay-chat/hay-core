import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D7-7: offline run harness. `simulation_runs` (one batch) and
 * `simulation_run_items` (one simulated conversation each).
 */
export class AddSimulationRuns1785830000000 implements MigrationInterface {
  name = "AddSimulationRuns1785830000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "simulation_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "kind" varchar(32) NOT NULL DEFAULT 'manual',
        "label" varchar(255),
        "status" varchar(16) NOT NULL DEFAULT 'running',
        "agent_id" uuid,
        "playbook_id" uuid,
        "playbook_version_id" uuid,
        "item_count" integer NOT NULL DEFAULT 0,
        "completed_count" integer NOT NULL DEFAULT 0,
        "failed_count" integer NOT NULL DEFAULT 0,
        "skipped_count" integer NOT NULL DEFAULT 0,
        "usage" jsonb NOT NULL DEFAULT '{}',
        "created_by_id" uuid,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_simulation_runs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_simulation_runs_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_simulation_runs_agent" FOREIGN KEY ("agent_id")
          REFERENCES "agents"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_simulation_runs_created_by" FOREIGN KEY ("created_by_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_simulation_runs_org_created"
        ON "simulation_runs" ("organization_id", "created_at");
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "simulation_run_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "run_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "position" integer NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "seed" jsonb NOT NULL,
        "source_ref" varchar(255),
        "conversation_id" uuid,
        "error" text,
        "usage" jsonb NOT NULL DEFAULT '{}',
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_simulation_run_items" PRIMARY KEY ("id"),
        CONSTRAINT "fk_simulation_run_items_run" FOREIGN KEY ("run_id")
          REFERENCES "simulation_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_simulation_run_items_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_simulation_run_items_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE SET NULL
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_simulation_run_items_run_position"
        ON "simulation_run_items" ("run_id", "position");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_simulation_run_items_org_created"
        ON "simulation_run_items" ("organization_id", "created_at");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_simulation_run_items_conversation"
        ON "simulation_run_items" ("conversation_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "simulation_run_items";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "simulation_runs";`);
  }
}
