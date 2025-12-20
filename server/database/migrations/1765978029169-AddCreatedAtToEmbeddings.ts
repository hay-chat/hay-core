import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreatedAtToEmbeddings1765978029169 implements MigrationInterface {
  name = "AddCreatedAtToEmbeddings1765978029169";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Simply add the created_at column to embeddings table
    await queryRunner.query(
      `ALTER TABLE "embeddings" ADD "created_at" TIMESTAMP NOT NULL DEFAULT now()`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the created_at column
    await queryRunner.query(`ALTER TABLE "embeddings" DROP COLUMN "created_at"`);
  }
}
