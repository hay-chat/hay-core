import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAvatarUrlToUsers1763321000000 implements MigrationInterface {
  name = "AddAvatarUrlToUsers1763321000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "avatar_url" character varying(500)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatar_url"`);
  }
}
