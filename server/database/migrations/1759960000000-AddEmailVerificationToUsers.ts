import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEmailVerificationToUsers1759960000000 implements MigrationInterface {
  name = "AddEmailVerificationToUsers1759960000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "pending_email" character varying(255),
      ADD COLUMN "email_verification_token_hash" character varying(255),
      ADD COLUMN "email_verification_expires_at" TIMESTAMP WITH TIME ZONE
    `);

    // Add index for faster lookups during verification
    await queryRunner.query(`
      CREATE INDEX "idx_users_email_verification_token"
      ON "users" ("email_verification_token_hash")
      WHERE "email_verification_token_hash" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_users_email_verification_token"`);
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN "email_verification_expires_at",
      DROP COLUMN "email_verification_token_hash",
      DROP COLUMN "pending_email"
    `);
  }
}
