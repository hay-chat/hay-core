import { MigrationInterface, QueryRunner } from "typeorm";

/** Finding or erasing a conversation's or message's embeddings by metadata, within an organization. */
export class AddEmbeddingMetadataIndexes1794000100000 implements MigrationInterface {
  name = "AddEmbeddingMetadataIndexes1794000100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_embeddings_org_metadata_conversation" ON "embeddings" ("organization_id", (metadata->>'conversationId'))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_embeddings_org_metadata_message" ON "embeddings" ("organization_id", (metadata->>'messageId'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_embeddings_org_metadata_message"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_embeddings_org_metadata_conversation"`);
  }
}
