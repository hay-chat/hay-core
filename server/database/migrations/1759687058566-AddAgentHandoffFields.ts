import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAgentHandoffFields1759687058566 implements MigrationInterface {
  name = "AddAgentHandoffFields1759687058566";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agents" ADD "human_handoff_available_instructions" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "agents" ADD "human_handoff_unavailable_instructions" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agents" DROP COLUMN "human_handoff_unavailable_instructions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agents" DROP COLUMN "human_handoff_available_instructions"`,
    );
  }
}
