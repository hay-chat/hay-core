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
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_privacy_requests" PRIMARY KEY ("id"),
        CONSTRAINT "fk_privacy_requests_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "fk_privacy_requests_job" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    // Create indexes for efficient queries
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_email" ON "privacy_requests" ("email")`);
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_status" ON "privacy_requests" ("status")`);
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_type" ON "privacy_requests" ("type")`);
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_created_at" ON "privacy_requests" ("created_at")`);
    await queryRunner.query(`CREATE INDEX "idx_privacy_requests_verification_expires" ON "privacy_requests" ("verification_expires_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop privacy_requests table indexes
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
