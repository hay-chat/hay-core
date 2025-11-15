import { MigrationInterface, QueryRunner } from "typeorm";

export class AlterAgentInstructionsToJsonb1730000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // First, we need to convert existing text data to jsonb
    // If the text contains valid JSON, parse it; otherwise, wrap it in a simple structure
    await queryRunner.query(`
      UPDATE agents
      SET instructions = CASE
        WHEN instructions IS NULL THEN NULL
        WHEN instructions::text ~ '^\\s*\\{' THEN instructions::jsonb
        ELSE jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
          jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', instructions)
          ))
        ))
      END
      WHERE instructions IS NOT NULL
    `);

    // Now alter the column type
    await queryRunner.query(`
      ALTER TABLE agents
      ALTER COLUMN instructions TYPE jsonb USING instructions::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Convert jsonb back to text
    await queryRunner.query(`
      ALTER TABLE agents
      ALTER COLUMN instructions TYPE text USING instructions::text
    `);
  }
}
