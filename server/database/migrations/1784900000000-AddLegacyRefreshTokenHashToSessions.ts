import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Pre-rotation JWT refresh tokens are accepted once (D11-3 migration path).
 * The session they turn into records the token's sha256; the unique index
 * makes a second use fail, even when two arrive at the same time.
 */
export class AddLegacyRefreshTokenHashToSessions1784900000000 implements MigrationInterface {
  name = "AddLegacyRefreshTokenHashToSessions1784900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "legacy_token_hash" varchar(64);`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_sessions_legacy_token_hash" ON "sessions" ("legacy_token_hash") WHERE "legacy_token_hash" IS NOT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_sessions_legacy_token_hash";`);
    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN IF EXISTS "legacy_token_hash";`);
  }
}
