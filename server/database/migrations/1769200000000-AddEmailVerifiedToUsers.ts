import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEmailVerifiedToUsers1769200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add email_verified column, default false for new users
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "email_verified" boolean NOT NULL DEFAULT false
    `);

    // Set all existing users as verified (they should not be locked out)
    await queryRunner.query(`
      UPDATE "users" SET "email_verified" = true
    `);

    // Add index for querying unverified users
    await queryRunner.query(`
      CREATE INDEX "idx_users_email_verified" ON "users"("email_verified")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_email_verified"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "email_verified"`);
  }
}
