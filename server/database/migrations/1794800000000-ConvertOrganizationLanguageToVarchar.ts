import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The organization language is checked in code against the full language list
 * (types/language.types.ts), so it no longer needs a Postgres enum of 33 values.
 */
export class ConvertOrganizationLanguageToVarchar1794800000000 implements MigrationInterface {
  name = "ConvertOrganizationLanguageToVarchar1794800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organizations" ALTER COLUMN "default_language" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ALTER COLUMN "default_language" TYPE varchar(10) USING "default_language"::text`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ALTER COLUMN "default_language" SET DEFAULT 'en'`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."organizations_default_language_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const values = [
      "en",
      "es",
      "fr",
      "de",
      "pt",
      "it",
      "nl",
      "ru",
      "zh",
      "ja",
      "ko",
      "ar",
      "hi",
      "tr",
      "pl",
      "sv",
      "da",
      "no",
      "fi",
      "el",
      "he",
      "th",
      "vi",
      "id",
      "ms",
      "cs",
      "sk",
      "hu",
      "ro",
      "bg",
      "uk",
      "ca",
      "hr",
    ];
    // Languages outside the old list fall back to English.
    await queryRunner.query(
      `UPDATE "organizations" SET "default_language" = 'en' WHERE NOT ("default_language" = ANY($1))`,
      [values],
    );
    await queryRunner.query(
      `CREATE TYPE "public"."organizations_default_language_enum" AS ENUM(${values.map((v) => `'${v}'`).join(", ")})`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ALTER COLUMN "default_language" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ALTER COLUMN "default_language" TYPE "public"."organizations_default_language_enum" USING "default_language"::"public"."organizations_default_language_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ALTER COLUMN "default_language" SET DEFAULT 'en'`,
    );
  }
}
