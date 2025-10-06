import { MigrationInterface, QueryRunner } from "typeorm";

export class AddConversationTakeover1759693957444 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add new columns for conversation takeover
        await queryRunner.query(`
            ALTER TABLE "conversations"
            ADD COLUMN "assigned_user_id" uuid NULL,
            ADD COLUMN "assigned_at" timestamptz NULL,
            ADD COLUMN "previous_status" varchar(50) NULL
        `);

        // Add foreign key constraint to users table
        await queryRunner.query(`
            ALTER TABLE "conversations"
            ADD CONSTRAINT "fk_conversations_assigned_user"
            FOREIGN KEY ("assigned_user_id")
            REFERENCES "users"("id")
            ON DELETE SET NULL
        `);

        // Add index for performance on assigned_user_id
        await queryRunner.query(`
            CREATE INDEX "idx_conversations_assigned_user_id"
            ON "conversations"("assigned_user_id")
        `);

        // Add composite index for filtering assigned conversations by status
        await queryRunner.query(`
            CREATE INDEX "idx_conversations_status_assigned"
            ON "conversations"("status", "assigned_user_id")
        `);

        // Update the status enum to include 'human-took-over'
        await queryRunner.query(`
            ALTER TYPE "conversations_status_enum"
            ADD VALUE IF NOT EXISTS 'human-took-over'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop indexes
        await queryRunner.query(`
            DROP INDEX IF EXISTS "idx_conversations_status_assigned"
        `);

        await queryRunner.query(`
            DROP INDEX IF EXISTS "idx_conversations_assigned_user_id"
        `);

        // Drop foreign key constraint
        await queryRunner.query(`
            ALTER TABLE "conversations"
            DROP CONSTRAINT IF EXISTS "fk_conversations_assigned_user"
        `);

        // Drop columns
        await queryRunner.query(`
            ALTER TABLE "conversations"
            DROP COLUMN IF EXISTS "assigned_user_id",
            DROP COLUMN IF EXISTS "assigned_at",
            DROP COLUMN IF EXISTS "previous_status"
        `);

        // Note: Cannot remove enum value in PostgreSQL easily
        // Would require recreating the enum type, which is complex with existing data
        // In production, it's generally safe to leave the unused enum value
    }

}
