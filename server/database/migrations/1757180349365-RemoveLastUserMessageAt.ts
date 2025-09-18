import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveLastUserMessageAt1757180349365 implements MigrationInterface {
  name = "RemoveLastUserMessageAt1757180349365";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "last_user_message_at"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD "last_user_message_at" TIMESTAMP WITH TIME ZONE`,
    );
  }
}
