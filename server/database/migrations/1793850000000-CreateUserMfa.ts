import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUserMfa1793850000000 implements MigrationInterface {
  name = "CreateUserMfa1793850000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_mfa" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" varchar,
        "updated_by" varchar,
        "metadata" jsonb,
        "user_id" uuid NOT NULL,
        "secret" text NOT NULL,
        "confirmed_at" timestamptz,
        "last_used_step" integer,
        "recovery_codes" jsonb NOT NULL DEFAULT '[]',
        "step_up_session_id" uuid,
        "step_up_expires_at" timestamptz,
        CONSTRAINT "pk_user_mfa" PRIMARY KEY ("id"),
        CONSTRAINT "fk_user_mfa_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_mfa_user_id" ON "user_mfa" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_mfa"`);
  }
}
