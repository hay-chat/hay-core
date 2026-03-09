import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLanguageToAgent1769400000000 implements MigrationInterface {
  name = "AddLanguageToAgent1769400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agents" ADD COLUMN "language" varchar(10) DEFAULT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agents" DROP COLUMN "language"`);
  }
}
