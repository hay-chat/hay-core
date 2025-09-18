import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEnabledToolsToConversation1757348976518 implements MigrationInterface {
  name = "AddEnabledToolsToConversation1757348976518";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" ADD "enabled_tools" text array`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "enabled_tools"`);
  }
}
