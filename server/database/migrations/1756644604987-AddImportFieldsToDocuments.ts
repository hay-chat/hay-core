import { MigrationInterface, QueryRunner } from "typeorm";

export class AddImportFieldsToDocuments1756644604987 implements MigrationInterface {
  name = "AddImportFieldsToDocuments1756644604987";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."documents_import_method_enum" AS ENUM('upload', 'web', 'plugin')`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "import_method" "public"."documents_import_method_enum" NOT NULL DEFAULT 'upload'`,
    );
    await queryRunner.query(`ALTER TABLE "documents" ADD "source_url" character varying`);
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "last_crawled_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "last_crawled_at"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "source_url"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "import_method"`);
    await queryRunner.query(`DROP TYPE "public"."documents_import_method_enum"`);
  }
}
