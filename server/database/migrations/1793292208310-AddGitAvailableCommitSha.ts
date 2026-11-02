import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Git-sourced plugins are no longer re-synced automatically: the scheduled
 * check records the newer commit it found, and an admin applies it.
 */
export class AddGitAvailableCommitSha1793292208310 implements MigrationInterface {
  name = "AddGitAvailableCommitSha1793292208310";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "plugin_registry" ADD COLUMN IF NOT EXISTS "git_available_commit_sha" varchar(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "plugin_registry" DROP COLUMN IF EXISTS "git_available_commit_sha"`,
    );
  }
}
