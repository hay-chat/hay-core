import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDocumentSourceLastSyncStartedAt1793840000000 implements MigrationInterface {
  name = "AddDocumentSourceLastSyncStartedAt1793840000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "document_sources" ADD COLUMN "last_sync_started_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "document_sources" DROP COLUMN "last_sync_started_at"`);
  }
}
