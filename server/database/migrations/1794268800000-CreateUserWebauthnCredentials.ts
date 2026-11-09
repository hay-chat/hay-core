import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUserWebauthnCredentials1794268800000 implements MigrationInterface {
  name = "CreateUserWebauthnCredentials1794268800000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_webauthn_credentials" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" varchar,
        "updated_by" varchar,
        "metadata" jsonb,
        "user_id" uuid NOT NULL,
        "credential_id" text NOT NULL,
        "public_key" bytea NOT NULL,
        "sign_count" bigint NOT NULL DEFAULT 0,
        "transports" jsonb NOT NULL DEFAULT '[]',
        "name" varchar(100) NOT NULL,
        "device_type" varchar(32) NOT NULL,
        "backed_up" boolean NOT NULL DEFAULT false,
        "last_used_at" timestamptz,
        CONSTRAINT "pk_user_webauthn_credentials" PRIMARY KEY ("id"),
        CONSTRAINT "fk_user_webauthn_credentials_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_webauthn_credentials_credential_id" ON "user_webauthn_credentials" ("credential_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_user_webauthn_credentials_user_id" ON "user_webauthn_credentials" ("user_id")`,
    );
    // A person with only security keys has no authenticator-app secret.
    await queryRunner.query(`ALTER TABLE "user_mfa" ALTER COLUMN "secret" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_webauthn_credentials"`);
    // Rows without a secret exist only for people using security keys.
    await queryRunner.query(`DELETE FROM "user_mfa" WHERE "secret" IS NULL`);
    await queryRunner.query(`ALTER TABLE "user_mfa" ALTER COLUMN "secret" SET NOT NULL`);
  }
}
