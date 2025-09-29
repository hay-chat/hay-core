import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrganizationLanguage1759162412251 implements MigrationInterface {
    name = 'AddOrganizationLanguage1759162412251'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."organizations_default_language_enum" AS ENUM('en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi', 'tr', 'pl', 'sv', 'da', 'no', 'fi', 'el', 'he', 'th', 'vi', 'id', 'ms', 'cs', 'sk', 'hu', 'ro', 'bg', 'uk', 'ca', 'hr')`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "default_language" "public"."organizations_default_language_enum" NOT NULL DEFAULT 'en'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "default_language"`);
        await queryRunner.query(`DROP TYPE "public"."organizations_default_language_enum"`);
    }

}
