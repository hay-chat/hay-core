import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Per-person languages (dashboard UI and conversation translation) and the
 * translations of each message, keyed by language code.
 */
export class AddUserLanguagesAndMessageTranslations1794800000100 implements MigrationInterface {
  name = "AddUserLanguagesAndMessageTranslations1794800000100";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "interface_language" varchar(10)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "translation_language" varchar(10)`,
    );
    await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "translations" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN IF EXISTS "translations"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "translation_language"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "interface_language"`);
  }
}
