import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductRecommendationMessageType1782000000001 implements MigrationInterface {
  name = "AddProductRecommendationMessageType1782000000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Presales product recommendations (P5): the orchestrator emits a structured
    // product-card message, persisted with type 'ProductRecommendation'. Add the
    // enum value so getPublicMessages and inserts stop failing with 22P02.
    await queryRunner.query(`
      ALTER TYPE "messages_type_enum" ADD VALUE IF NOT EXISTS 'ProductRecommendation';
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL cannot drop enum values without recreating the type, which would
    // require rewriting the messages table. Leave the value in place on rollback.
    console.warn(
      'Warning: Cannot remove enum values in PostgreSQL. The "ProductRecommendation" message type will remain in the enum.',
    );
  }
}
