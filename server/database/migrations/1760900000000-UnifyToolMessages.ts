import { MigrationInterface, QueryRunner } from "typeorm";

export class UnifyToolMessages1760900000000 implements MigrationInterface {
    name = 'UnifyToolMessages1760900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add new 'Tool' enum value to message type
        await queryRunner.query(`
            ALTER TYPE "messages_type_enum" ADD VALUE IF NOT EXISTS 'Tool';
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Note: PostgreSQL doesn't support removing enum values directly
        // This would require recreating the enum type, which is complex
        // For now, we'll leave the 'Tool' value in place even on rollback
        console.warn('Warning: Cannot remove enum values in PostgreSQL. The "Tool" message type will remain in the enum.');
    }

}
