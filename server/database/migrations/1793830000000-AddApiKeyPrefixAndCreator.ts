import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * API tokens record a display prefix and who created them. Existing tokens
 * stay NULL: the prefix cannot be recovered from the stored hash.
 */
export class AddApiKeyPrefixAndCreator1793830000000 implements MigrationInterface {
  name = "AddApiKeyPrefixAndCreator1793830000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "key_prefix" varchar(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "api_keys" ADD CONSTRAINT "fk_api_keys_created_by_user"
          FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "fk_api_keys_created_by_user"`,
    );
    await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "created_by_user_id"`);
    await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "key_prefix"`);
  }
}
