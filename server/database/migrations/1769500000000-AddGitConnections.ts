import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGitConnections1769500000000 implements MigrationInterface {
  name = "AddGitConnections1769500000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    // Create git_connections table
    await queryRunner.query(`
      CREATE TABLE "git_connections" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "provider" varchar(50) NOT NULL,
        "installation_id" varchar(255) NOT NULL,
        "account_login" varchar(255) NOT NULL,
        "account_type" varchar(50),
        "permissions" jsonb,
        "repository_selection" varchar(50),
        "installed_by_id" uuid,
        "status" varchar(50) NOT NULL DEFAULT 'active',
        "last_sync_at" timestamptz,
        "last_sync_error" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_git_connections" PRIMARY KEY ("id")
      )
    `);

    // Foreign keys
    await queryRunner.query(`
      ALTER TABLE "git_connections"
        ADD CONSTRAINT "fk_git_connections_organization"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "git_connections"
        ADD CONSTRAINT "fk_git_connections_installed_by"
        FOREIGN KEY ("installed_by_id") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // Indexes
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_git_connections_org_provider_installation"
        ON "git_connections"("organization_id", "provider", "installation_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_git_connections_organization_id"
        ON "git_connections"("organization_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_git_connections_status"
        ON "git_connections"("status")
    `);

    // Add git columns to plugin_registry
    await queryRunner.query(`
      ALTER TABLE "plugin_registry"
        ADD COLUMN "git_connection_id" uuid,
        ADD COLUMN "git_repo_full_name" varchar(500),
        ADD COLUMN "git_branch" varchar(255),
        ADD COLUMN "git_last_commit_sha" varchar(64),
        ADD COLUMN "git_last_sync_at" timestamptz,
        ADD COLUMN "git_sync_error" text
    `);

    await queryRunner.query(`
      ALTER TABLE "plugin_registry"
        ADD CONSTRAINT "fk_plugin_registry_git_connection"
        FOREIGN KEY ("git_connection_id") REFERENCES "git_connections"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_plugin_registry_git_connection_id"
        ON "plugin_registry"("git_connection_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Remove git columns from plugin_registry
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_plugin_registry_git_connection_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "plugin_registry"
        DROP CONSTRAINT IF EXISTS "fk_plugin_registry_git_connection"
    `);

    await queryRunner.query(`
      ALTER TABLE "plugin_registry"
        DROP COLUMN IF EXISTS "git_connection_id",
        DROP COLUMN IF EXISTS "git_repo_full_name",
        DROP COLUMN IF EXISTS "git_branch",
        DROP COLUMN IF EXISTS "git_last_commit_sha",
        DROP COLUMN IF EXISTS "git_last_sync_at",
        DROP COLUMN IF EXISTS "git_sync_error"
    `);

    // Drop git_connections table
    await queryRunner.query(`DROP TABLE IF EXISTS "git_connections"`);
  }
}
