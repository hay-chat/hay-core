import { MigrationInterface, QueryRunner } from "typeorm";

export class FixAuditLogsCascadeConstraints1768200100000 implements MigrationInterface {
  name = "FixAuditLogsCascadeConstraints1768200100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Get all foreign key constraints on audit_logs table
    const constraints = await queryRunner.query(`
      SELECT constraint_name, column_name
      FROM information_schema.key_column_usage
      WHERE table_name = 'audit_logs'
        AND constraint_name LIKE 'FK_%'
    `);

    // Drop existing foreign key constraints
    for (const constraint of constraints) {
      try {
        await queryRunner.query(
          `ALTER TABLE "audit_logs" DROP CONSTRAINT "${constraint.constraint_name}"`,
        );
      } catch (e) {
        // Constraint might not exist, continue
      }
    }

    // Also try to drop the named constraints from the original migration
    try {
      await queryRunner.query(
        `ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "fk_audit_logs_user"`,
      );
    } catch (e) {
      // Ignore if doesn't exist
    }

    try {
      await queryRunner.query(
        `ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "fk_audit_logs_organization"`,
      );
    } catch (e) {
      // Ignore if doesn't exist
    }

    // Create new foreign key constraints with proper cascade behavior
    // User: SET NULL on delete (keep audit log, just remove user reference)
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      ADD CONSTRAINT "fk_audit_logs_user"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // Organization: CASCADE on delete (delete audit logs when org is deleted)
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      ADD CONSTRAINT "fk_audit_logs_organization"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the new constraints
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "fk_audit_logs_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "fk_audit_logs_organization"`,
    );

    // Recreate without cascade (original behavior)
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      ADD CONSTRAINT "fk_audit_logs_user"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      ADD CONSTRAINT "fk_audit_logs_organization"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }
}
