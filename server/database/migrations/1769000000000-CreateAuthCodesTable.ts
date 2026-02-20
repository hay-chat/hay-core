import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuthCodesTable1769000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "auth_codes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" varchar,
        "updated_by" varchar,
        "metadata" jsonb,
        "user_id" uuid NOT NULL,
        "code_hash" varchar(128) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used" boolean NOT NULL DEFAULT false,
        CONSTRAINT "pk_auth_codes" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "auth_codes"
      ADD CONSTRAINT "fk_auth_codes_user"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_auth_codes_code_hash" ON "auth_codes"("code_hash")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_auth_codes_expires_at" ON "auth_codes"("expires_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_codes"`);
  }
}
