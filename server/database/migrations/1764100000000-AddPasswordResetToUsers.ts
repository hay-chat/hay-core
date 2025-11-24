import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPasswordResetToUsers1764100000000 implements MigrationInterface {
  name = "AddPasswordResetToUsers1764100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add password reset token fields
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD "password_reset_token_hash" character varying(255),
      ADD "password_reset_expires_at" TIMESTAMP WITH TIME ZONE
    `);

    // Create index for fast token lookups (with partial index for non-null values)
    await queryRunner.query(`
      CREATE INDEX "idx_users_password_reset_token"
      ON "users" ("password_reset_token_hash")
      WHERE "password_reset_token_hash" IS NOT NULL
    `);

    // Add comments for documentation
    await queryRunner.query(`
      COMMENT ON COLUMN "users"."password_reset_token_hash" IS 'Hashed password reset token (argon2), null when no reset is pending'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "users"."password_reset_expires_at" IS 'Expiration timestamp for password reset token (typically 24 hours)'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index first
    await queryRunner.query(`DROP INDEX "idx_users_password_reset_token"`);

    // Drop columns
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN "password_reset_token_hash",
      DROP COLUMN "password_reset_expires_at"
    `);
  }
}
