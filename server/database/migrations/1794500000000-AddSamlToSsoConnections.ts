import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSamlToSsoConnections1794500000000 implements MigrationInterface {
  name = "AddSamlToSsoConnections1794500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sso_connections" ADD COLUMN IF NOT EXISTS "protocol" varchar(10) NOT NULL DEFAULT 'oidc'`,
    );
    await queryRunner.query(
      `ALTER TABLE "sso_connections" ADD COLUMN IF NOT EXISTS "saml_entry_point" varchar(1024)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sso_connections" ADD COLUMN IF NOT EXISTS "saml_certificate" text`,
    );
    // A SAML connection has no client credentials.
    await queryRunner.query(`ALTER TABLE "sso_connections" ALTER COLUMN "client_id" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "sso_connections" ALTER COLUMN "client_secret" DROP NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "sso_connections" ADD CONSTRAINT "chk_sso_connections_protocol" CHECK (
        ("protocol" = 'oidc' AND "client_id" IS NOT NULL AND "client_secret" IS NOT NULL)
        OR ("protocol" = 'saml' AND "saml_entry_point" IS NOT NULL AND "saml_certificate" IS NOT NULL)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sso_connections" DROP CONSTRAINT IF EXISTS "chk_sso_connections_protocol"`,
    );
    await queryRunner.query(`DELETE FROM "sso_connections" WHERE "protocol" <> 'oidc'`);
    await queryRunner.query(
      `ALTER TABLE "sso_connections" ALTER COLUMN "client_secret" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "sso_connections" ALTER COLUMN "client_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "sso_connections" DROP COLUMN IF EXISTS "saml_certificate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sso_connections" DROP COLUMN IF EXISTS "saml_entry_point"`,
    );
    await queryRunner.query(`ALTER TABLE "sso_connections" DROP COLUMN IF EXISTS "protocol"`);
  }
}
