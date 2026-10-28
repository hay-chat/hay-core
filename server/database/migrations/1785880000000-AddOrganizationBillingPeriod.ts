import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Lane A1: the operator's current billing period on the organization, so the
 * usage page and the exclusion allowance follow the billing period instead of
 * the UTC calendar month. Null (self-hosted, or before the first sync) keeps
 * calendar months.
 */
export class AddOrganizationBillingPeriod1785880000000 implements MigrationInterface {
  name = "AddOrganizationBillingPeriod1785880000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN IF NOT EXISTS "billing_period_start" timestamptz,
        ADD COLUMN IF NOT EXISTS "billing_period_end" timestamptz;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP COLUMN IF EXISTS "billing_period_end",
        DROP COLUMN IF EXISTS "billing_period_start";
    `);
  }
}
