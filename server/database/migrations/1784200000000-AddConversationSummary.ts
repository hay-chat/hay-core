import { MigrationInterface, QueryRunner } from "typeorm";

export class AddConversationSummary1784200000000 implements MigrationInterface {
  name = "AddConversationSummary1784200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversations" ADD COLUMN "summary" text;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversations" DROP COLUMN "summary";
    `);
  }
}
