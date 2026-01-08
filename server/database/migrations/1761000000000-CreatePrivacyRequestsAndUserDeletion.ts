import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePrivacyRequestsAndUserDeletion1761000000000 implements MigrationInterface {
  name = "CreatePrivacyRequestsAndUserDeletion1761000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add deletedAt column to users table for soft delete
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMP WITH TIME ZONE
    `);

    // Create index on deletedAt for filtering
    await queryRunner.query(`
      CREATE INDEX "idx_users_deleted_at" ON "users" ("deleted_at")
    `);

    // Create privacy_requests table
    await queryRunner.query(`
      CREATE TABLE "privacy_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying(255) NOT NULL,
        "user_id" uuid,
        "type" character varying(20) NOT NULL CHECK (type IN ('export', 'deletion', 'rectification')),
        "status" character varying(30) NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification', 'verified', 'processing', 'completed', 'failed', 'expired', 'cancelled')),
        "verification_token_hash" character varying(255),
        "verification_expires_at" TIMESTAMP WITH TIME ZONE,
        "verified_at" TIMESTAMP WITH TIME ZONE,
        "job_id" uuid,
        "ip_address" character varying(45),
        "user_agent" character varying(500),
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "metadata" jsonb,
        "error_message" text,
        "download_ip_address" VARCHAR(45),
        "downloaded_at" TIMESTAMPTZ,
        "download_count" INTEGER NOT NULL DEFAULT 0,
        "max_downloads" INTEGER NOT NULL DEFAULT 1,
        "subject_type" character varying(20) NOT NULL DEFAULT 'user' CHECK (subject_type IN ('user', 'customer')),
        "customer_id" uuid,
        "organization_id" uuid,
        "identifier_type" character varying(20) CHECK (identifier_type IS NULL OR identifier_type IN ('email', 'phone', 'externalId')),
        "identifier_value" character varying(255),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_privacy_requests" PRIMARY KEY ("id"),
        CONSTRAINT "fk_privacy_requests_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "fk_privacy_requests_job" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "fk_privacy_requests_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "fk_privacy_requests_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "chk_privacy_requests_subject_integrity" CHECK (
          (subject_type = 'user' AND user_id IS NOT NULL AND customer_id IS NULL) OR
          (subject_type = 'customer' AND customer_id IS NOT NULL AND user_id IS NULL)
        )
      )
    `);

    // Create indexes for efficient queries
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_email" ON "privacy_requests" ("email")`);
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_status" ON "privacy_requests" ("status")`);
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_type" ON "privacy_requests" ("type")`);
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_created_at" ON "privacy_requests" ("created_at")`);
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_verification_expires" ON "privacy_requests" ("verification_expires_at")`);
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_subject_type" ON "privacy_requests" ("subject_type")`);
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_customer_id" ON "privacy_requests" ("customer_id")`);
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_organization_id" ON "privacy_requests" ("organization_id")`);
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_identifier" ON "privacy_requests" ("identifier_type", "identifier_value")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop privacy_requests table indexes
    await queryRunner.query(`DROP INDEX "public"."idx_privacy_requests_identifier"`);
    await queryRunner.query(`DROP INDEX "public"."idx_privacy_requests_organization_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_privacy_requests_customer_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_privacy_requests_subject_type"`);
    await queryRunner.query(`DROP INDEX "public"."idx_privacy_requests_verification_expires"`);
    await queryRunner.query(`DROP INDEX "public"."idx_privacy_requests_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_privacy_requests_type"`);
    await queryRunner.query(`DROP INDEX "public"."idx_privacy_requests_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_privacy_requests_email"`);

    // Drop privacy_requests table
    await queryRunner.query(`DROP TABLE "privacy_requests"`);

    // Drop users.deleted_at index and column
    await queryRunner.query(`DROP INDEX "public"."idx_users_deleted_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deleted_at"`);
  }
}
