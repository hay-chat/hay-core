import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D5-6: `business_hours_schedules`, opening hours per channel (or the
 * organization default, channels = '{}'), each with its own timezone, weekly
 * intervals and closures. No rows = always within hours (today's behaviour).
 */
export class AddBusinessHoursSchedules1785740000000 implements MigrationInterface {
  name = "AddBusinessHoursSchedules1785740000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "business_hours_schedules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "timezone" varchar(64) NOT NULL,
        "channels" text[] NOT NULL DEFAULT '{}',
        "weekly_hours" jsonb NOT NULL DEFAULT '[]',
        "closures" jsonb NOT NULL DEFAULT '[]',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_business_hours_schedules" PRIMARY KEY ("id"),
        CONSTRAINT "fk_business_hours_schedules_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_business_hours_schedules_organization"
        ON "business_hours_schedules" ("organization_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "business_hours_schedules";`);
  }
}
