import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D7-10: a judged simulation item stores its verdict (checks, judge opinion,
 * reply, tool calls) and the replay-report bucket it falls in.
 */
export class AddSimulationItemVerdicts1785851000000 implements MigrationInterface {
  name = "AddSimulationItemVerdicts1785851000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "simulation_run_items"
        ADD COLUMN IF NOT EXISTS "verdict" jsonb,
        ADD COLUMN IF NOT EXISTS "bucket" varchar(32);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_simulation_run_items_run_bucket"
        ON "simulation_run_items" ("run_id", "bucket");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_simulation_run_items_run_bucket";`);
    await queryRunner.query(`
      ALTER TABLE "simulation_run_items"
        DROP COLUMN IF EXISTS "bucket",
        DROP COLUMN IF EXISTS "verdict";
    `);
  }
}
