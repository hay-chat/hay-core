import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUploadEntityAndUpdateOrganization1763215684928 implements MigrationInterface {
    name = 'CreateUploadEntityAndUpdateOrganization1763215684928'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_organizations" DROP CONSTRAINT "FK_user_organizations_user"`);
        await queryRunner.query(`ALTER TABLE "user_organizations" DROP CONSTRAINT "FK_user_organizations_organization"`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP CONSTRAINT "FK_api_keys_organization"`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" DROP CONSTRAINT "FK_organization_invitations_invited_by"`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" DROP CONSTRAINT "FK_organization_invitations_organization"`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" DROP CONSTRAINT "FK_organization_invitations_invited_user"`);
        await queryRunner.query(`DROP INDEX "public"."idx_api_keys_organization_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_users_deleted_at"`);
        await queryRunner.query(`ALTER TABLE "organizations" RENAME COLUMN "logo" TO "logo_upload_id"`);
        await queryRunner.query(`CREATE TABLE "uploads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" character varying, "updated_by" character varying, "metadata" jsonb, "filename" character varying(500) NOT NULL, "original_name" character varying(500) NOT NULL, "path" character varying(1000) NOT NULL, "mime_type" character varying(100) NOT NULL, "size" bigint NOT NULL, "storage_type" character varying(50) NOT NULL, "folder" character varying(100) NOT NULL, "organization_id" uuid NOT NULL, "uploaded_by_id" uuid, CONSTRAINT "PK_d1781d1eedd7459314f60f39bd3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_uploads_created_at" ON "uploads" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "idx_uploads_folder" ON "uploads" ("folder") `);
        await queryRunner.query(`CREATE INDEX "idx_uploads_organization_id" ON "uploads" ("organization_id") `);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN "metadata"`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "user_id" uuid NOT NULL`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP CONSTRAINT "FK_a283bdef18876e525aefaec042f"`);
        await queryRunner.query(`ALTER TABLE "api_keys" ALTER COLUMN "organization_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "logo_upload_id"`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "logo_upload_id" uuid`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD CONSTRAINT "UQ_d5e7b288783d98c84cdb5f83616" UNIQUE ("logo_upload_id")`);
        await queryRunner.query(`DROP INDEX "public"."idx_organization_invitations_status"`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" DROP COLUMN "status"`);
        await queryRunner.query(`DROP TYPE "public"."organization_invitations_status_enum"`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" ADD "status" character varying(20) NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`ALTER TYPE "public"."messages_type_enum" RENAME TO "messages_type_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."messages_type_enum" AS ENUM('Customer', 'System', 'HumanAgent', 'BotAgent', 'Tool', 'Document', 'Playbook')`);
        await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "type" TYPE "public"."messages_type_enum" USING "type"::"text"::"public"."messages_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."messages_type_enum_old"`);
        await queryRunner.query(`CREATE INDEX "idx_api_keys_organization" ON "api_keys" ("organization_id") `);
        await queryRunner.query(`CREATE INDEX "idx_api_keys_user_id" ON "api_keys" ("user_id") `);
        await queryRunner.query(`CREATE INDEX "idx_organization_invitations_status" ON "organization_invitations" ("status") `);
        await queryRunner.query(`ALTER TABLE "user_organizations" ADD CONSTRAINT "FK_6881b23cd1a8924e4bf61515fbb" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_organizations" ADD CONSTRAINT "FK_9dae16cdea66aeba1eb6f6ddf29" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD CONSTRAINT "FK_a3baee01d8408cd3c0f89a9a973" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD CONSTRAINT "FK_a283bdef18876e525aefaec042f" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "uploads" ADD CONSTRAINT "FK_dd6ef381dc39b4e2f60e504cdcc" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "uploads" ADD CONSTRAINT "FK_e4eac210e1666317baf35a7dd40" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD CONSTRAINT "FK_d5e7b288783d98c84cdb5f83616" FOREIGN KEY ("logo_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" ADD CONSTRAINT "FK_7f88954e8d667a76ae3ced6f446" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" ADD CONSTRAINT "FK_8510c6828ceb2df38a00f252cb3" FOREIGN KEY ("invited_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" ADD CONSTRAINT "FK_8ab435d962010401bc62c8d9e38" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organization_invitations" DROP CONSTRAINT "FK_8ab435d962010401bc62c8d9e38"`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" DROP CONSTRAINT "FK_8510c6828ceb2df38a00f252cb3"`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" DROP CONSTRAINT "FK_7f88954e8d667a76ae3ced6f446"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP CONSTRAINT "FK_d5e7b288783d98c84cdb5f83616"`);
        await queryRunner.query(`ALTER TABLE "uploads" DROP CONSTRAINT "FK_e4eac210e1666317baf35a7dd40"`);
        await queryRunner.query(`ALTER TABLE "uploads" DROP CONSTRAINT "FK_dd6ef381dc39b4e2f60e504cdcc"`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP CONSTRAINT "FK_a283bdef18876e525aefaec042f"`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP CONSTRAINT "FK_a3baee01d8408cd3c0f89a9a973"`);
        await queryRunner.query(`ALTER TABLE "user_organizations" DROP CONSTRAINT "FK_9dae16cdea66aeba1eb6f6ddf29"`);
        await queryRunner.query(`ALTER TABLE "user_organizations" DROP CONSTRAINT "FK_6881b23cd1a8924e4bf61515fbb"`);
        await queryRunner.query(`DROP INDEX "public"."idx_organization_invitations_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_api_keys_user_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_api_keys_organization"`);
        await queryRunner.query(`CREATE TYPE "public"."messages_type_enum_old" AS ENUM('Customer', 'System', 'HumanAgent', 'BotAgent', 'ToolCall', 'ToolResponse', 'Document', 'Playbook', 'Tool')`);
        await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "type" TYPE "public"."messages_type_enum_old" USING "type"::"text"::"public"."messages_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."messages_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."messages_type_enum_old" RENAME TO "messages_type_enum"`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" DROP COLUMN "status"`);
        await queryRunner.query(`CREATE TYPE "public"."organization_invitations_status_enum" AS ENUM('pending', 'accepted', 'declined', 'expired', 'cancelled')`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" ADD "status" "public"."organization_invitations_status_enum" NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`CREATE INDEX "idx_organization_invitations_status" ON "organization_invitations" ("status") `);
        await queryRunner.query(`ALTER TABLE "organizations" DROP CONSTRAINT "UQ_d5e7b288783d98c84cdb5f83616"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "logo_upload_id"`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "logo_upload_id" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "api_keys" ALTER COLUMN "organization_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD CONSTRAINT "FK_a283bdef18876e525aefaec042f" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "user_id"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD "metadata" jsonb`);
        await queryRunner.query(`ALTER TABLE "users" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`DROP INDEX "public"."idx_uploads_organization_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_uploads_folder"`);
        await queryRunner.query(`DROP INDEX "public"."idx_uploads_created_at"`);
        await queryRunner.query(`DROP TABLE "uploads"`);
        await queryRunner.query(`ALTER TABLE "organizations" RENAME COLUMN "logo_upload_id" TO "logo"`);
        await queryRunner.query(`CREATE INDEX "idx_users_deleted_at" ON "users" ("deleted_at") `);
        await queryRunner.query(`CREATE INDEX "idx_api_keys_organization_id" ON "api_keys" ("organization_id") `);
        await queryRunner.query(`ALTER TABLE "organization_invitations" ADD CONSTRAINT "FK_organization_invitations_invited_user" FOREIGN KEY ("invited_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" ADD CONSTRAINT "FK_organization_invitations_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" ADD CONSTRAINT "FK_organization_invitations_invited_by" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD CONSTRAINT "FK_api_keys_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_organizations" ADD CONSTRAINT "FK_user_organizations_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_organizations" ADD CONSTRAINT "FK_user_organizations_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
