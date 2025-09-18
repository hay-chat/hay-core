import { MigrationInterface, QueryRunner } from "typeorm";

export class MakePlaybookOrgIdNullable1756475900000 implements MigrationInterface {
  name = "MakePlaybookOrgIdNullable1756475900000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Make organization_id nullable for system playbooks
    await queryRunner.query(`ALTER TABLE "playbooks" ALTER COLUMN "organization_id" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to not null
    await queryRunner.query(`ALTER TABLE "playbooks" ALTER COLUMN "organization_id" SET NOT NULL`);
  }
}
