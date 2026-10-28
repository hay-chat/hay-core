import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D7-9: replays and test cases carry what each simulated turn is checked
 * against (the human reply, expected outcomes). Null for plain simulations.
 */
export class AddSimulationItemExpectations1785850000000 implements MigrationInterface {
  name = "AddSimulationItemExpectations1785850000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "simulation_run_items"
        ADD COLUMN IF NOT EXISTS "expectations" jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "simulation_run_items" DROP COLUMN IF EXISTS "expectations";
    `);
  }
}
