import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDefaultConfidenceSettings1730059200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add default confidence guardrail settings to existing organizations
    // This migration updates the settings JSONB field with default confidence configuration
    await queryRunner.query(`
      UPDATE organizations
      SET settings = COALESCE(settings, '{}'::jsonb) || '{
        "confidenceGuardrail": {
          "highThreshold": 0.8,
          "mediumThreshold": 0.5,
          "enableRecheck": true,
          "enableEscalation": true,
          "fallbackMessage": "I'\''m not confident I can provide an accurate answer to this question based on the available information. Let me connect you with a team member who can help.",
          "recheckConfig": {
            "maxDocuments": 10,
            "similarityThreshold": 0.3
          }
        }
      }'::jsonb
      WHERE settings->'confidenceGuardrail' IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove confidence guardrail settings from all organizations
    await queryRunner.query(`
      UPDATE organizations
      SET settings = settings - 'confidenceGuardrail'
      WHERE settings->'confidenceGuardrail' IS NOT NULL
    `);
  }
}
