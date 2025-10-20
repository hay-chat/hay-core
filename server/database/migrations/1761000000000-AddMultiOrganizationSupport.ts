import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMultiOrganizationSupport1761000000000 implements MigrationInterface {
  name = "AddMultiOrganizationSupport1761000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum for organization invitation status
    await queryRunner.query(`
      CREATE TYPE "public"."organization_invitations_status_enum" AS ENUM(
        'pending',
        'accepted',
        'declined',
        'expired',
        'cancelled'
      )
    `);

    // Create user_organizations join table
    await queryRunner.query(`
      CREATE TABLE "user_organizations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying,
        "updated_by" character varying,
        "metadata" jsonb,
        "user_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "role" character varying(50) NOT NULL DEFAULT 'member',
        "permissions" jsonb,
        "is_active" boolean NOT NULL DEFAULT true,
        "invited_at" TIMESTAMP WITH TIME ZONE,
        "invited_by" character varying(255),
        "joined_at" TIMESTAMP WITH TIME ZONE,
        "last_accessed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_user_organizations" PRIMARY KEY ("id"),
        CONSTRAINT "uq_user_organizations_user_org" UNIQUE ("user_id", "organization_id")
      )
    `);

    // Create indexes for user_organizations
    await queryRunner.query(`
      CREATE INDEX "idx_user_organizations_user" ON "user_organizations" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_user_organizations_organization" ON "user_organizations" ("organization_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_user_organizations_role" ON "user_organizations" ("role")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_user_organizations_is_active" ON "user_organizations" ("is_active")
    `);

    // Add foreign key constraints for user_organizations
    await queryRunner.query(`
      ALTER TABLE "user_organizations"
      ADD CONSTRAINT "FK_user_organizations_user"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "user_organizations"
      ADD CONSTRAINT "FK_user_organizations_organization"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // Create organization_invitations table
    await queryRunner.query(`
      CREATE TABLE "organization_invitations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying,
        "updated_by" character varying,
        "metadata" jsonb,
        "organization_id" uuid NOT NULL,
        "email" character varying(255) NOT NULL,
        "invited_user_id" uuid,
        "invited_by" uuid,
        "role" character varying(50) NOT NULL DEFAULT 'member',
        "permissions" jsonb,
        "token_hash" character varying(255) NOT NULL,
        "status" "public"."organization_invitations_status_enum" NOT NULL DEFAULT 'pending',
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "accepted_at" TIMESTAMP WITH TIME ZONE,
        "message" text,
        CONSTRAINT "PK_organization_invitations" PRIMARY KEY ("id")
      )
    `);

    // Create indexes for organization_invitations
    await queryRunner.query(`
      CREATE INDEX "idx_organization_invitations_email" ON "organization_invitations" ("email")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_organization_invitations_organization" ON "organization_invitations" ("organization_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_organization_invitations_status" ON "organization_invitations" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_organization_invitations_token" ON "organization_invitations" ("token_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_organization_invitations_invited_user" ON "organization_invitations" ("invited_user_id")
    `);

    // Add foreign key constraints for organization_invitations
    await queryRunner.query(`
      ALTER TABLE "organization_invitations"
      ADD CONSTRAINT "FK_organization_invitations_organization"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "organization_invitations"
      ADD CONSTRAINT "FK_organization_invitations_invited_user"
      FOREIGN KEY ("invited_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "organization_invitations"
      ADD CONSTRAINT "FK_organization_invitations_invited_by"
      FOREIGN KEY ("invited_by") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // Migrate existing user-organization relationships to user_organizations table
    await queryRunner.query(`
      INSERT INTO "user_organizations" (
        "user_id",
        "organization_id",
        "role",
        "permissions",
        "is_active",
        "joined_at",
        "created_at",
        "updated_at"
      )
      SELECT
        "id" as "user_id",
        "organization_id",
        "role",
        "permissions",
        "is_active",
        "created_at" as "joined_at",
        NOW() as "created_at",
        NOW() as "updated_at"
      FROM "users"
      WHERE "organization_id" IS NOT NULL
    `);

    // Note: We're keeping the organization_id and role columns on users table
    // for backward compatibility. They will be deprecated in a future migration.
    // For now, they should be kept in sync with user_organizations table.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key constraints for organization_invitations
    await queryRunner.query(`
      ALTER TABLE "organization_invitations"
      DROP CONSTRAINT "FK_organization_invitations_invited_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "organization_invitations"
      DROP CONSTRAINT "FK_organization_invitations_invited_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "organization_invitations"
      DROP CONSTRAINT "FK_organization_invitations_organization"
    `);

    // Drop indexes for organization_invitations
    await queryRunner.query(`DROP INDEX "public"."idx_organization_invitations_invited_user"`);
    await queryRunner.query(`DROP INDEX "public"."idx_organization_invitations_token"`);
    await queryRunner.query(`DROP INDEX "public"."idx_organization_invitations_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_organization_invitations_organization"`);
    await queryRunner.query(`DROP INDEX "public"."idx_organization_invitations_email"`);

    // Drop organization_invitations table
    await queryRunner.query(`DROP TABLE "organization_invitations"`);

    // Drop organization_invitations_status enum
    await queryRunner.query(`DROP TYPE "public"."organization_invitations_status_enum"`);

    // Drop foreign key constraints for user_organizations
    await queryRunner.query(`
      ALTER TABLE "user_organizations"
      DROP CONSTRAINT "FK_user_organizations_organization"
    `);
    await queryRunner.query(`
      ALTER TABLE "user_organizations"
      DROP CONSTRAINT "FK_user_organizations_user"
    `);

    // Drop indexes for user_organizations
    await queryRunner.query(`DROP INDEX "public"."idx_user_organizations_is_active"`);
    await queryRunner.query(`DROP INDEX "public"."idx_user_organizations_role"`);
    await queryRunner.query(`DROP INDEX "public"."idx_user_organizations_organization"`);
    await queryRunner.query(`DROP INDEX "public"."idx_user_organizations_user"`);

    // Drop user_organizations table
    await queryRunner.query(`DROP TABLE "user_organizations"`);
  }
}
