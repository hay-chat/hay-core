import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTestModeSourcesAndFeedback1760000000000 implements MigrationInterface {
    name = 'AddTestModeSourcesAndFeedback1760000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create enum types
        await queryRunner.query(`
            CREATE TYPE "sources_category_enum" AS ENUM('test', 'messaging', 'social', 'email', 'helpdesk')
        `);

        await queryRunner.query(`
            CREATE TYPE "message_feedback_rating_enum" AS ENUM('good', 'bad', 'neutral')
        `);

        await queryRunner.query(`
            CREATE TYPE "messages_delivery_state_enum" AS ENUM('queued', 'sent', 'blocked')
        `);

        // Create sources table
        await queryRunner.query(`
            CREATE TABLE "sources" (
                "id" character varying(50) NOT NULL,
                "name" character varying(100) NOT NULL,
                "description" text,
                "category" "sources_category_enum" NOT NULL,
                "plugin_id" character varying(100),
                "is_active" boolean NOT NULL DEFAULT true,
                "icon" character varying(50),
                "metadata" jsonb,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_sources" PRIMARY KEY ("id")
            )
        `);

        // Create indexes for sources
        await queryRunner.query(`CREATE INDEX "idx_sources_category" ON "sources" ("category")`);
        await queryRunner.query(`CREATE INDEX "idx_sources_plugin_id" ON "sources" ("plugin_id")`);
        await queryRunner.query(`CREATE INDEX "idx_sources_is_active" ON "sources" ("is_active")`);

        // Seed initial sources
        await queryRunner.query(`
            INSERT INTO "sources" ("id", "name", "description", "category", "is_active") VALUES
            ('playground', 'Playground', 'Test environment for AI conversation testing', 'test', true),
            ('webchat', 'Web Chat', 'Website chat widget conversations', 'messaging', true)
        `);

        // Create message_feedback table
        await queryRunner.query(`
            CREATE TABLE "message_feedback" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "message_id" uuid NOT NULL,
                "organization_id" uuid NOT NULL,
                "reviewer_id" uuid NOT NULL,
                "rating" "message_feedback_rating_enum" NOT NULL,
                "comment" text,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_message_feedback" PRIMARY KEY ("id")
            )
        `);

        // Create indexes for message_feedback
        await queryRunner.query(`CREATE INDEX "idx_message_feedback_message_id" ON "message_feedback" ("message_id")`);
        await queryRunner.query(`CREATE INDEX "idx_message_feedback_organization_id" ON "message_feedback" ("organization_id")`);
        await queryRunner.query(`CREATE INDEX "idx_message_feedback_reviewer_id" ON "message_feedback" ("reviewer_id")`);
        await queryRunner.query(`CREATE INDEX "idx_message_feedback_rating" ON "message_feedback" ("rating")`);

        // Add foreign keys to message_feedback
        await queryRunner.query(`
            ALTER TABLE "message_feedback"
            ADD CONSTRAINT "FK_message_feedback_message"
            FOREIGN KEY ("message_id")
            REFERENCES "messages"("id")
            ON DELETE CASCADE
        `);

        await queryRunner.query(`
            ALTER TABLE "message_feedback"
            ADD CONSTRAINT "FK_message_feedback_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "organizations"("id")
            ON DELETE CASCADE
        `);

        await queryRunner.query(`
            ALTER TABLE "message_feedback"
            ADD CONSTRAINT "FK_message_feedback_reviewer"
            FOREIGN KEY ("reviewer_id")
            REFERENCES "users"("id")
            ON DELETE CASCADE
        `);

        // Add new columns to messages table
        await queryRunner.query(`
            ALTER TABLE "messages"
            ADD "source_id" character varying(50) NOT NULL DEFAULT 'webchat'
        `);

        await queryRunner.query(`
            ALTER TABLE "messages"
            ADD "review_required" boolean NOT NULL DEFAULT false
        `);

        await queryRunner.query(`
            ALTER TABLE "messages"
            ADD "delivery_state" "messages_delivery_state_enum" NOT NULL DEFAULT 'sent'
        `);

        await queryRunner.query(`
            ALTER TABLE "messages"
            ADD "approved_by" uuid
        `);

        await queryRunner.query(`
            ALTER TABLE "messages"
            ADD "approved_at" TIMESTAMP WITH TIME ZONE
        `);

        await queryRunner.query(`
            ALTER TABLE "messages"
            ADD "original_content" text
        `);

        // Create indexes for messages new columns
        await queryRunner.query(`CREATE INDEX "idx_messages_source_id" ON "messages" ("source_id")`);
        await queryRunner.query(`CREATE INDEX "idx_messages_review_required" ON "messages" ("review_required")`);
        await queryRunner.query(`CREATE INDEX "idx_messages_delivery_state" ON "messages" ("delivery_state")`);

        // Add foreign key from messages to sources
        await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_messages_source"
            FOREIGN KEY ("source_id")
            REFERENCES "sources"("id")
            ON DELETE RESTRICT
        `);

        // Add foreign key from messages to users (approved_by)
        await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_messages_approved_by"
            FOREIGN KEY ("approved_by")
            REFERENCES "users"("id")
            ON DELETE SET NULL
        `);

        // Add test_mode column to agents table
        await queryRunner.query(`
            ALTER TABLE "agents"
            ADD "test_mode" boolean
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop agents column
        await queryRunner.query(`ALTER TABLE "agents" DROP COLUMN "test_mode"`);

        // Drop messages foreign keys and columns
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_messages_approved_by"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_messages_source"`);

        await queryRunner.query(`DROP INDEX "public"."idx_messages_delivery_state"`);
        await queryRunner.query(`DROP INDEX "public"."idx_messages_review_required"`);
        await queryRunner.query(`DROP INDEX "public"."idx_messages_source_id"`);

        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "original_content"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "approved_at"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "approved_by"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "delivery_state"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "review_required"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "source_id"`);

        // Drop message_feedback foreign keys and table
        await queryRunner.query(`ALTER TABLE "message_feedback" DROP CONSTRAINT "FK_message_feedback_reviewer"`);
        await queryRunner.query(`ALTER TABLE "message_feedback" DROP CONSTRAINT "FK_message_feedback_organization"`);
        await queryRunner.query(`ALTER TABLE "message_feedback" DROP CONSTRAINT "FK_message_feedback_message"`);

        await queryRunner.query(`DROP INDEX "public"."idx_message_feedback_rating"`);
        await queryRunner.query(`DROP INDEX "public"."idx_message_feedback_reviewer_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_message_feedback_organization_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_message_feedback_message_id"`);

        await queryRunner.query(`DROP TABLE "message_feedback"`);

        // Drop sources indexes and table
        await queryRunner.query(`DROP INDEX "public"."idx_sources_is_active"`);
        await queryRunner.query(`DROP INDEX "public"."idx_sources_plugin_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_sources_category"`);

        await queryRunner.query(`DROP TABLE "sources"`);

        // Drop enum types
        await queryRunner.query(`DROP TYPE "messages_delivery_state_enum"`);
        await queryRunner.query(`DROP TYPE "message_feedback_rating_enum"`);
        await queryRunner.query(`DROP TYPE "sources_category_enum"`);
    }
}
