import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D4-9: per-playbook approval override. Write categories listed here always
 * need approval while the playbook is active (tighten-only).
 */
export class AddPlaybookApprovalCategories1785744000000 implements MigrationInterface {
  name = "AddPlaybookApprovalCategories1785744000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "playbooks" ADD COLUMN IF NOT EXISTS "approval_categories" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "playbooks" DROP COLUMN IF EXISTS "approval_categories"`);
  }
}
