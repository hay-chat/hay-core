import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCustomerPrivacySupport1760990805000 implements MigrationInterface {
  name = "AddCustomerPrivacySupport1760990805000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add subject_type column with default 'user' for existing records
    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      ADD COLUMN "subject_type" character varying(20) NOT NULL DEFAULT 'user'
      CHECK (subject_type IN ('user', 'customer'))
    `);

    // Add customer_id column
    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      ADD COLUMN "customer_id" uuid
    `);

    // Add organization_id column for customer requests
    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      ADD COLUMN "organization_id" uuid
    `);

    // Add identifier_type for customer lookups
    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      ADD COLUMN "identifier_type" character varying(20)
      CHECK (identifier_type IS NULL OR identifier_type IN ('email', 'phone', 'externalId'))
    `);

    // Add identifier_value for customer lookups
    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      ADD COLUMN "identifier_value" character varying(255)
    `);

    // Add foreign key constraint for customer_id
    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      ADD CONSTRAINT "fk_privacy_requests_customer"
      FOREIGN KEY ("customer_id")
      REFERENCES "customers"("id")
      ON DELETE SET NULL
      ON UPDATE NO ACTION
    `);

    // Add foreign key constraint for organization_id
    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      ADD CONSTRAINT "fk_privacy_requests_organization"
      FOREIGN KEY ("organization_id")
      REFERENCES "organizations"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    // Create indexes for efficient queries
    await queryRunner.query(`
      CREATE INDEX "idx_privacy_requests_subject_type"
      ON "privacy_requests" ("subject_type")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_privacy_requests_customer_id"
      ON "privacy_requests" ("customer_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_privacy_requests_organization_id"
      ON "privacy_requests" ("organization_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_privacy_requests_identifier"
      ON "privacy_requests" ("identifier_type", "identifier_value")
    `);

    // Add check constraint for data integrity
    // Either (user request AND has user_id) OR (customer request AND has customer_id)
    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      ADD CONSTRAINT "chk_privacy_requests_subject_integrity"
      CHECK (
        (subject_type = 'user' AND user_id IS NOT NULL AND customer_id IS NULL) OR
        (subject_type = 'customer' AND customer_id IS NOT NULL AND user_id IS NULL)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop check constraint
    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      DROP CONSTRAINT "chk_privacy_requests_subject_integrity"
    `);

    // Drop indexes
    await queryRunner.query(`
      DROP INDEX "public"."idx_privacy_requests_identifier"
    `);

    await queryRunner.query(`
      DROP INDEX "public"."idx_privacy_requests_organization_id"
    `);

    await queryRunner.query(`
      DROP INDEX "public"."idx_privacy_requests_customer_id"
    `);

    await queryRunner.query(`
      DROP INDEX "public"."idx_privacy_requests_subject_type"
    `);

    // Drop foreign key constraints
    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      DROP CONSTRAINT "fk_privacy_requests_organization"
    `);

    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      DROP CONSTRAINT "fk_privacy_requests_customer"
    `);

    // Drop columns
    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      DROP COLUMN "identifier_value"
    `);

    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      DROP COLUMN "identifier_type"
    `);

    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      DROP COLUMN "organization_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      DROP COLUMN "customer_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "privacy_requests"
      DROP COLUMN "subject_type"
    `);
  }
}
