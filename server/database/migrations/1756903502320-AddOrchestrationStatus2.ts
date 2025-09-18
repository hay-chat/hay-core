import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrchestrationStatus21756903502320 implements MigrationInterface {
  name = "AddOrchestrationStatus21756903502320";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_conversations_processing_locked_until"`);
    await queryRunner.query(`ALTER TABLE "conversations" ADD "orchestration_status" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "orchestration_status"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_conversations_processing_locked_until" ON "conversations" ("processing_locked_until") WHERE (processing_locked_until IS NOT NULL)`,
    );
  }
}
