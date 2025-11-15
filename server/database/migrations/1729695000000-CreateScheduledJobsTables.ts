import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateScheduledJobsTables1729695000000 implements MigrationInterface {
  name = "CreateScheduledJobsTables1729695000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create scheduled_jobs table
    await queryRunner.query(`
      CREATE TABLE "scheduled_jobs" (
        "name" VARCHAR(255) NOT NULL,
        "description" TEXT NOT NULL,
        "schedule" TEXT NOT NULL,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "last_run" TIMESTAMPTZ,
        "last_status" VARCHAR(50),
        "last_error" TEXT,
        "total_runs" INTEGER NOT NULL DEFAULT 0,
        "total_failures" INTEGER NOT NULL DEFAULT 0,
        "average_duration" INTEGER NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scheduled_jobs" PRIMARY KEY ("name")
      )
    `);

    // Add comments for documentation
    await queryRunner.query(`
      COMMENT ON TABLE "scheduled_jobs" IS 'Stores metadata and status for scheduled/cron jobs'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "scheduled_jobs"."schedule" IS 'Cron expression or interval in milliseconds (as string)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "scheduled_jobs"."average_duration" IS 'Average execution duration in milliseconds'
    `);

    // Create scheduled_job_history table
    await queryRunner.query(`
      CREATE TABLE "scheduled_job_history" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "job_name" VARCHAR(255) NOT NULL,
        "started_at" TIMESTAMPTZ NOT NULL,
        "completed_at" TIMESTAMPTZ,
        "status" VARCHAR(50) NOT NULL,
        "duration" INTEGER NOT NULL,
        "error" TEXT,
        "metadata" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scheduled_job_history" PRIMARY KEY ("id")
      )
    `);

    // Add indexes for performance
    await queryRunner.query(`
      CREATE INDEX "IDX_scheduled_job_history_job_name" ON "scheduled_job_history" ("job_name")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_scheduled_job_history_job_name_started_at"
      ON "scheduled_job_history" ("job_name", "started_at")
    `);

    // Add comments
    await queryRunner.query(`
      COMMENT ON TABLE "scheduled_job_history" IS 'Execution history for scheduled jobs'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "scheduled_job_history"."duration" IS 'Execution duration in milliseconds'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scheduled_job_history_job_name_started_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scheduled_job_history_job_name"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "scheduled_job_history"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "scheduled_jobs"`);
  }
}
