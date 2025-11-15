import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUploadEntityAndUpdateOrganization1763216000000 implements MigrationInterface {
  name = "CreateUploadEntityAndUpdateOrganization1763216000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create uploads table
    await queryRunner.query(`
      CREATE TABLE "uploads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying,
        "updated_by" character varying,
        "metadata" jsonb,
        "filename" character varying(500) NOT NULL,
        "original_name" character varying(500) NOT NULL,
        "path" character varying(1000) NOT NULL,
        "mime_type" character varying(100) NOT NULL,
        "size" bigint NOT NULL,
        "storage_type" character varying(50) NOT NULL,
        "folder" character varying(100) NOT NULL,
        "organization_id" uuid NOT NULL,
        "uploaded_by_id" uuid,
        CONSTRAINT "PK_uploads" PRIMARY KEY ("id")
      )
    `);

    // Create indexes
    await queryRunner.query(`CREATE INDEX "idx_uploads_created_at" ON "uploads" ("created_at")`);
    await queryRunner.query(`CREATE INDEX "idx_uploads_folder" ON "uploads" ("folder")`);
    await queryRunner.query(`CREATE INDEX "idx_uploads_organization_id" ON "uploads" ("organization_id")`);

    // Add foreign key constraints
    await queryRunner.query(`
      ALTER TABLE "uploads"
      ADD CONSTRAINT "FK_uploads_organization"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "uploads"
      ADD CONSTRAINT "FK_uploads_uploaded_by"
      FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // Remove old logo column and add new logo_upload_id column to organizations
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "logo"`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN "logo_upload_id" uuid`);
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD CONSTRAINT "UQ_organizations_logo_upload_id" UNIQUE ("logo_upload_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD CONSTRAINT "FK_organizations_logo_upload"
      FOREIGN KEY ("logo_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove foreign key constraints
    await queryRunner.query(`ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "FK_organizations_logo_upload"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "UQ_organizations_logo_upload_id"`);
    await queryRunner.query(`ALTER TABLE "uploads" DROP CONSTRAINT IF EXISTS "FK_uploads_uploaded_by"`);
    await queryRunner.query(`ALTER TABLE "uploads" DROP CONSTRAINT IF EXISTS "FK_uploads_organization"`);

    // Remove logo_upload_id column and restore logo column
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "logo_upload_id"`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN "logo" character varying(255)`);

    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_uploads_organization_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_uploads_folder"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_uploads_created_at"`);

    // Drop uploads table
    await queryRunner.query(`DROP TABLE "uploads"`);
  }
}
