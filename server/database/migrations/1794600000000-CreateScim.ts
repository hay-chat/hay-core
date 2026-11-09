import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateScim1794600000000 implements MigrationInterface {
  name = "CreateScim1794600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scim_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" varchar,
        "updated_by" varchar,
        "metadata" jsonb,
        "organization_id" uuid NOT NULL,
        "token_hash" varchar(64) NOT NULL,
        "token_prefix" varchar(16) NOT NULL,
        "last_used_at" timestamptz,
        CONSTRAINT "pk_scim_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "fk_scim_tokens_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_scim_tokens_organization" ON "scim_tokens" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_scim_tokens_token_hash" ON "scim_tokens" ("token_hash")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scim_users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" varchar,
        "updated_by" varchar,
        "metadata" jsonb,
        "organization_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "external_id" varchar(255),
        CONSTRAINT "pk_scim_users" PRIMARY KEY ("id"),
        CONSTRAINT "fk_scim_users_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_scim_users_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_scim_users_organization_user" ON "scim_users" ("organization_id", "user_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_scim_users_organization_external_id" ON "scim_users" ("organization_id", "external_id") WHERE "external_id" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scim_groups" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" varchar,
        "updated_by" varchar,
        "metadata" jsonb,
        "organization_id" uuid NOT NULL,
        "display_name" varchar(255) NOT NULL,
        "external_id" varchar(255),
        CONSTRAINT "pk_scim_groups" PRIMARY KEY ("id"),
        CONSTRAINT "fk_scim_groups_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_scim_groups_organization_display_name" ON "scim_groups" ("organization_id", "display_name")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_scim_groups_organization_external_id" ON "scim_groups" ("organization_id", "external_id") WHERE "external_id" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scim_group_members" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" varchar,
        "updated_by" varchar,
        "metadata" jsonb,
        "organization_id" uuid NOT NULL,
        "group_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        CONSTRAINT "pk_scim_group_members" PRIMARY KEY ("id"),
        CONSTRAINT "fk_scim_group_members_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_scim_group_members_group" FOREIGN KEY ("group_id") REFERENCES "scim_groups"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_scim_group_members_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_scim_group_members_group_user" ON "scim_group_members" ("group_id", "user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_scim_group_members_organization_user" ON "scim_group_members" ("organization_id", "user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "scim_group_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "scim_groups"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "scim_users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "scim_tokens"`);
  }
}
