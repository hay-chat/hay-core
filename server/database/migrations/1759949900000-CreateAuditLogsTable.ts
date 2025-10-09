import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuditLogsTable1759949900000 implements MigrationInterface {
  name = "CreateAuditLogsTable1759949900000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create audit_logs table
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "organization_id" uuid,
        "action" character varying(100) NOT NULL,
        "resource" character varying(100),
        "changes" jsonb,
        "metadata" jsonb,
        "ip_address" character varying(45),
        "user_agent" character varying(500),
        "status" character varying(100),
        "error_message" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_audit_logs_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "fk_audit_logs_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    // Create indexes
    await queryRunner.query(`CREATE INDEX "idx_audit_logs_user" ON "audit_logs" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "idx_audit_logs_organization" ON "audit_logs" ("organization_id")`);
    await queryRunner.query(`CREATE INDEX "idx_audit_logs_action" ON "audit_logs" ("action")`);
    await queryRunner.query(`CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs" ("created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX "public"."idx_audit_logs_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_audit_logs_action"`);
    await queryRunner.query(`DROP INDEX "public"."idx_audit_logs_organization"`);
    await queryRunner.query(`DROP INDEX "public"."idx_audit_logs_user"`);

    // Drop table
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
