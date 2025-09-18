import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDocumentIdsToConversations1757172417396 implements MigrationInterface {
  name = "AddDocumentIdsToConversations1757172417396";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" ADD "document_ids" uuid array`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "document_ids"`);
  }
}
