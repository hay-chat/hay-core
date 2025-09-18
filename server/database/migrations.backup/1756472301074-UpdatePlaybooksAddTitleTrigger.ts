import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdatePlaybooksAddTitleTrigger1756472301074 implements MigrationInterface {
  name = "UpdatePlaybooksAddTitleTrigger1756472301074";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update playbooks table
    await queryRunner.query(`ALTER TABLE "playbooks" DROP COLUMN "name"`);
    await queryRunner.query(`ALTER TABLE "playbooks" ADD "title" character varying(255) NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "playbooks" ADD "trigger" character varying(255) NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "playbooks" DROP COLUMN "instructions"`);
    await queryRunner.query(`ALTER TABLE "playbooks" ADD "instructions" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert playbooks table changes
    await queryRunner.query(`ALTER TABLE "playbooks" DROP COLUMN "instructions"`);
    await queryRunner.query(`ALTER TABLE "playbooks" ADD "instructions" text`);
    await queryRunner.query(`ALTER TABLE "playbooks" DROP COLUMN "trigger"`);
    await queryRunner.query(`ALTER TABLE "playbooks" DROP COLUMN "title"`);
    await queryRunner.query(`ALTER TABLE "playbooks" ADD "name" character varying(255) NOT NULL`);
  }
}
