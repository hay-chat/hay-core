import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFallbackPlaybooks1756584135154 implements MigrationInterface {
    name = 'AddFallbackPlaybooks1756584135154'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Insert fallback system playbooks for handling unknown requests and human escalation
        await queryRunner.query(`
            INSERT INTO playbooks (id, title, trigger, description, kind, prompt_template, instructions, required_fields, status, is_system, created_at, updated_at, organization_id)
            VALUES 
            (
                gen_random_uuid(),
                'Unknown Request Handler',
                'unknown_request',
                'Handles requests where specific information is not available',
                'custom',
                'I understand your request, but I don''t have that specific information available right now.',
                '{"text": "CRITICAL: Never make up information. Always acknowledge when you don''t know something. Offer to help in other ways or connect with a human if needed."}'::jsonb,
                '[]'::jsonb,
                'active',
                true,
                NOW(),
                NOW(),
                NULL
            ),
            (
                gen_random_uuid(),
                'Human Escalation',
                'human_escalation',
                'Handles requests to speak with a human representative',
                'custom',
                'I understand you''d like to speak with a human representative. I''ll make sure your request is prioritized.',
                '{"text": "IMPORTANT: Never provide fake contact information. Simply acknowledge the request and indicate that a human will be available to help. Do not make up email addresses, phone numbers, or support hours."}'::jsonb,
                '[]'::jsonb,
                'active',
                true,
                NOW(),
                NOW(),
                NULL
            ),
            (
                gen_random_uuid(),
                'No Information Available',
                'no_info',
                'Response when no relevant information is found in knowledge base',
                'custom',
                'I don''t have specific information about that in my knowledge base. I''d be happy to help you with other questions, or I can connect you with someone who might have more details.',
                '{"text": "Use this when RAG search returns no results or low confidence results. Never make up information to fill the gap."}'::jsonb,
                '[]'::jsonb,
                'active',
                true,
                NOW(),
                NOW(),
                NULL
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove the fallback playbooks
        await queryRunner.query(`
            DELETE FROM playbooks 
            WHERE trigger IN ('unknown_request', 'human_escalation', 'no_info')
            AND is_system = true
        `);
    }
}
