import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSingleSignOn1794400000000 implements MigrationInterface {
  name = "CreateSingleSignOn1794400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sso_connections" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" varchar,
        "updated_by" varchar,
        "metadata" jsonb,
        "organization_id" uuid NOT NULL,
        "issuer" varchar(512) NOT NULL,
        "client_id" varchar(255) NOT NULL,
        "client_secret" text NOT NULL,
        "default_role" varchar(50) NOT NULL DEFAULT 'member',
        "role_claim" varchar(100),
        "role_mapping" jsonb NOT NULL DEFAULT '{}',
        "enabled" boolean NOT NULL DEFAULT false,
        "last_login_at" timestamptz,
        CONSTRAINT "pk_sso_connections" PRIMARY KEY ("id"),
        CONSTRAINT "fk_sso_connections_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_sso_connections_organization" ON "sso_connections" ("organization_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sso_domains" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" varchar,
        "updated_by" varchar,
        "metadata" jsonb,
        "organization_id" uuid NOT NULL,
        "domain" varchar(253) NOT NULL,
        "verification_token" varchar(64) NOT NULL,
        "verified_at" timestamptz,
        CONSTRAINT "pk_sso_domains" PRIMARY KEY ("id"),
        CONSTRAINT "fk_sso_domains_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_sso_domains_organization_domain" ON "sso_domains" ("organization_id", "domain")`,
    );
    // Only one organization can own a domain; unproven claims never block the owner.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_sso_domains_verified_domain" ON "sso_domains" ("domain") WHERE "verified_at" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sso_identities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" varchar,
        "updated_by" varchar,
        "metadata" jsonb,
        "organization_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "issuer" varchar(512) NOT NULL,
        "subject" varchar(255) NOT NULL,
        "last_login_at" timestamptz,
        CONSTRAINT "pk_sso_identities" PRIMARY KEY ("id"),
        CONSTRAINT "fk_sso_identities_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_sso_identities_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_sso_identities_subject" ON "sso_identities" ("organization_id", "issuer", "subject")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_sso_identities_user" ON "sso_identities" ("organization_id", "user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_sso_identities_user_id" ON "sso_identities" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sso_identities"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sso_domains"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sso_connections"`);
  }
}
