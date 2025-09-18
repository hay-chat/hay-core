import { MigrationInterface, QueryRunner } from "typeorm";

export class InsertDefaultPlaybooks1756476000000 implements MigrationInterface {
  name = "InsertDefaultPlaybooks1756476000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert default system playbooks (no organization_id means system playbook)
    await queryRunner.query(`
            INSERT INTO playbooks (id, title, trigger, description, kind, prompt_template, required_fields, status, is_system, created_at, updated_at, organization_id)
            VALUES 
            (
                gen_random_uuid(),
                'Default Welcome',
                'default_welcome',
                'Default system welcome message for new conversations',
                'welcome',
                'Hello! I''m here to help you today. What can I assist you with?',
                '[]'::jsonb,
                'active',
                true,
                NOW(),
                NOW(),
                NULL
            ),
            (
                gen_random_uuid(),
                'Default Ender',
                'default_ender',
                'Default system ender message',
                'ender',
                'Is there anything else I can help you with?',
                '[]'::jsonb,
                'active',
                true,
                NOW(),
                NOW(),
                NULL
            ),
            (
                gen_random_uuid(),
                'Default Intake',
                'default_intake',
                'Default intake flow for collecting user information',
                'custom',
                'Thank you {{name}}! I''ve noted your email ({{email}}) and will ensure our team follows up with you shortly. We typically respond within 24 hours.',
                '["name", "email"]'::jsonb,
                'active',
                true,
                NOW(),
                NOW(),
                NULL
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove default system playbooks
    await queryRunner.query(`
            DELETE FROM playbooks 
            WHERE trigger IN ('default_welcome', 'default_ender', 'default_intake')
            AND is_system = true
        `);
  }
}
