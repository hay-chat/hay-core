import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAgentAvatar1769100000000 implements MigrationInterface {
  name = "AddAgentAvatar1769100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agents" ADD COLUMN "avatar_upload_id" uuid`);
    await queryRunner.query(`
      ALTER TABLE "agents"
      ADD CONSTRAINT "UQ_agents_avatar_upload_id" UNIQUE ("avatar_upload_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "agents"
      ADD CONSTRAINT "FK_agents_avatar_upload"
      FOREIGN KEY ("avatar_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "FK_agents_avatar_upload"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "UQ_agents_avatar_upload_id"`,
    );
    await queryRunner.query(`ALTER TABLE "agents" DROP COLUMN "avatar_upload_id"`);
  }
}
