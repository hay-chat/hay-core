import { MigrationInterface, QueryRunner } from "typeorm";

/** Auth codes remember the origin they were issued for. Existing codes stay NULL and expire within minutes. */
export class AddAuthCodeRedirectOrigin1793840100000 implements MigrationInterface {
  name = "AddAuthCodeRedirectOrigin1793840100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth_codes" ADD COLUMN IF NOT EXISTS "redirect_origin" varchar(512)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth_codes" DROP COLUMN IF EXISTS "redirect_origin"`);
  }
}
