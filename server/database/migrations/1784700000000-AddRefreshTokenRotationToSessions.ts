import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Turn the (never used) `sessions` table into refresh-token families for
 * rotating, sliding sessions (D11-3).
 *
 * The refresh token is now derived from (id, generation) with an HMAC, so the
 * stored hash goes away; `revoked_at`/`revoked_reason` replace `is_active`.
 * No backfill: nothing wrote to this table before.
 */
export class AddRefreshTokenRotationToSessions1784700000000 implements MigrationInterface {
  name = "AddRefreshTokenRotationToSessions1784700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_sessions_refresh_token_hash";`);
    await queryRunner.query(`
      ALTER TABLE "sessions"
        DROP COLUMN IF EXISTS "refresh_token_hash",
        DROP COLUMN IF EXISTS "is_active",
        ADD COLUMN IF NOT EXISTS "generation" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "token_version" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "rotated_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "revoked_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "revoked_reason" varchar(32);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sessions"
        DROP COLUMN IF EXISTS "generation",
        DROP COLUMN IF EXISTS "token_version",
        DROP COLUMN IF EXISTS "rotated_at",
        DROP COLUMN IF EXISTS "revoked_at",
        DROP COLUMN IF EXISTS "revoked_reason",
        ADD COLUMN IF NOT EXISTS "refresh_token_hash" varchar(255) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
    `);
    await queryRunner.query(
      `ALTER TABLE "sessions" ALTER COLUMN "refresh_token_hash" DROP DEFAULT;`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_sessions_refresh_token_hash" ON "sessions" ("refresh_token_hash");`,
    );
  }
}
