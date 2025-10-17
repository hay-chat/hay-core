import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLanguageAndDefaultAgentSupport1760701520144 implements MigrationInterface {
    name = 'AddLanguageAndDefaultAgentSupport1760701520144'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_messages_source"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_messages_approved_by"`);
        await queryRunner.query(`ALTER TABLE "message_feedback" DROP CONSTRAINT "FK_message_feedback_message"`);
        await queryRunner.query(`ALTER TABLE "message_feedback" DROP CONSTRAINT "FK_message_feedback_organization"`);
        await queryRunner.query(`ALTER TABLE "message_feedback" DROP CONSTRAINT "FK_message_feedback_reviewer"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "fk_audit_logs_user"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "fk_audit_logs_organization"`);
        await queryRunner.query(`DROP INDEX "public"."idx_users_email_verification_token"`);
        await queryRunner.query(`DROP INDEX "public"."idx_sources_category"`);
        await queryRunner.query(`DROP INDEX "public"."idx_sources_plugin_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_sources_is_active"`);
        await queryRunner.query(`DROP INDEX "public"."idx_messages_source_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_messages_review_required"`);
        await queryRunner.query(`DROP INDEX "public"."idx_messages_delivery_state"`);
        await queryRunner.query(`DROP INDEX "public"."idx_message_feedback_message_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_message_feedback_organization_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_message_feedback_reviewer_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_message_feedback_rating"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN "metadata"`);
        await queryRunner.query(`ALTER TABLE "agents" ADD "initial_greeting" text`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "default_agent_id" uuid`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD "language" character varying(10)`);
        await queryRunner.query(`ALTER TABLE "sources" DROP COLUMN "created_at"`);
        await queryRunner.query(`ALTER TABLE "sources" ADD "created_at" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "sources" DROP COLUMN "updated_at"`);
        await queryRunner.query(`ALTER TABLE "sources" ADD "updated_at" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "message_feedback" DROP COLUMN "created_at"`);
        await queryRunner.query(`ALTER TABLE "message_feedback" ADD "created_at" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD CONSTRAINT "FK_3585cc614e8a7affb6061997e59" FOREIGN KEY ("default_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "FK_e8a45dded260918817bcf1a0ecc" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "FK_2f4b4b30d0f39d338b2ca367f0c" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "message_feedback" ADD CONSTRAINT "FK_ca21e42f59ad7a1f2638a86aedf" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "message_feedback" ADD CONSTRAINT "FK_e08fe6093844b24137af09eea55" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "message_feedback" ADD CONSTRAINT "FK_5fa636c2b366675c3a8a7c664c9" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_bd2726fd31b35443f2245b93ba0" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_145f35b204c731ba7fc1a0be0e7" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_145f35b204c731ba7fc1a0be0e7"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_bd2726fd31b35443f2245b93ba0"`);
        await queryRunner.query(`ALTER TABLE "message_feedback" DROP CONSTRAINT "FK_5fa636c2b366675c3a8a7c664c9"`);
        await queryRunner.query(`ALTER TABLE "message_feedback" DROP CONSTRAINT "FK_e08fe6093844b24137af09eea55"`);
        await queryRunner.query(`ALTER TABLE "message_feedback" DROP CONSTRAINT "FK_ca21e42f59ad7a1f2638a86aedf"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_2f4b4b30d0f39d338b2ca367f0c"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_e8a45dded260918817bcf1a0ecc"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP CONSTRAINT "FK_3585cc614e8a7affb6061997e59"`);
        await queryRunner.query(`ALTER TABLE "message_feedback" DROP COLUMN "created_at"`);
        await queryRunner.query(`ALTER TABLE "message_feedback" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "sources" DROP COLUMN "updated_at"`);
        await queryRunner.query(`ALTER TABLE "sources" ADD "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "sources" DROP COLUMN "created_at"`);
        await queryRunner.query(`ALTER TABLE "sources" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "language"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "default_agent_id"`);
        await queryRunner.query(`ALTER TABLE "agents" DROP COLUMN "initial_greeting"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD "metadata" jsonb`);
        await queryRunner.query(`CREATE INDEX "idx_message_feedback_rating" ON "message_feedback" ("rating") `);
        await queryRunner.query(`CREATE INDEX "idx_message_feedback_reviewer_id" ON "message_feedback" ("reviewer_id") `);
        await queryRunner.query(`CREATE INDEX "idx_message_feedback_organization_id" ON "message_feedback" ("organization_id") `);
        await queryRunner.query(`CREATE INDEX "idx_message_feedback_message_id" ON "message_feedback" ("message_id") `);
        await queryRunner.query(`CREATE INDEX "idx_messages_delivery_state" ON "messages" ("delivery_state") `);
        await queryRunner.query(`CREATE INDEX "idx_messages_review_required" ON "messages" ("review_required") `);
        await queryRunner.query(`CREATE INDEX "idx_messages_source_id" ON "messages" ("source_id") `);
        await queryRunner.query(`CREATE INDEX "idx_sources_is_active" ON "sources" ("is_active") `);
        await queryRunner.query(`CREATE INDEX "idx_sources_plugin_id" ON "sources" ("plugin_id") `);
        await queryRunner.query(`CREATE INDEX "idx_sources_category" ON "sources" ("category") `);
        await queryRunner.query(`CREATE INDEX "idx_users_email_verification_token" ON "users" ("email_verification_token_hash") WHERE (email_verification_token_hash IS NOT NULL)`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "message_feedback" ADD CONSTRAINT "FK_message_feedback_reviewer" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "message_feedback" ADD CONSTRAINT "FK_message_feedback_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "message_feedback" ADD CONSTRAINT "FK_message_feedback_message" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "FK_messages_approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "FK_messages_source" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

}
