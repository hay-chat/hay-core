import { MigrationInterface, QueryRunner } from "typeorm";

export class AddConversationPlaybookAndMetadata1756478995043 implements MigrationInterface {
    name = 'AddConversationPlaybookAndMetadata1756478995043'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add playbook_id column
        await queryRunner.query(`ALTER TABLE "conversations" ADD "playbook_id" uuid`);
        
        // Add metadata column
        await queryRunner.query(`ALTER TABLE "conversations" ADD "metadata" jsonb`);
        
        // Add needs_processing column
        await queryRunner.query(`ALTER TABLE "conversations" ADD "needs_processing" boolean NOT NULL DEFAULT false`);
        
        // Add last_processed_at column
        await queryRunner.query(`ALTER TABLE "conversations" ADD "last_processed_at" TIMESTAMP WITH TIME ZONE`);
        
        // Add index for playbook_id for better query performance
        await queryRunner.query(`CREATE INDEX "IDX_conversations_playbook_id" ON "conversations" ("playbook_id")`);
        
        // Add index for needs_processing for the orchestrator queries
        await queryRunner.query(`CREATE INDEX "IDX_conversations_needs_processing" ON "conversations" ("needs_processing") WHERE needs_processing = true`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop indexes
        await queryRunner.query(`DROP INDEX "public"."IDX_conversations_needs_processing"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_conversations_playbook_id"`);
        
        // Drop columns
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "last_processed_at"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "needs_processing"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "metadata"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "playbook_id"`);
    }
}