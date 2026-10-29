import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Audit trail integrity:
 * - Deleting an organization keeps its audit rows: the FK becomes ON DELETE
 *   SET NULL and `original_organization_id` (plain column, no FK, filled on
 *   insert) keeps them attributable.
 * - Rows are append-only. UPDATE is allowed only for
 *   (a) FK SET NULL actions (user/organization reference cleared, nothing else
 *       changed), and
 *   (b) erasure anonymisation, which detaches a row from its user and may
 *       rewrite the personal fields (ip, user agent, changes, metadata) but not
 *       the event itself (id, time, action, resource, organization, status).
 * - DELETE is allowed only when the transaction set `hay.audit_logs_purge`
 *   to 'on' (the retention job, see AuditLogService.cleanup).
 */
export class HardenAuditLogs1793292146423 implements MigrationInterface {
  name = "HardenAuditLogs1793292146423";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "original_organization_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "audit_logs" SET "original_organization_id" = "organization_id" WHERE "original_organization_id" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_audit_logs_original_organization" ON "audit_logs" ("original_organization_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "fk_audit_logs_organization"`,
    );
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      ADD CONSTRAINT "fk_audit_logs_organization"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_logs_set_original_organization() RETURNS trigger AS $$
      BEGIN
        NEW.original_organization_id := COALESCE(NEW.organization_id, NEW.original_organization_id);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "audit_logs_set_original_organization"
      BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION audit_logs_set_original_organization()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF current_setting('hay.audit_logs_purge', true) = 'on' THEN
            RETURN OLD;
          END IF;
          RAISE EXCEPTION 'audit_logs rows cannot be deleted outside the retention job'
            USING ERRCODE = 'insufficient_privilege';
        END IF;

        -- (a) FK ON DELETE SET NULL: only the user/organization reference is cleared.
        IF (to_jsonb(NEW) - 'user_id' - 'organization_id') = (to_jsonb(OLD) - 'user_id' - 'organization_id')
           AND (NEW.user_id IS NULL OR NEW.user_id = OLD.user_id)
           AND (NEW.organization_id IS NULL OR NEW.organization_id = OLD.organization_id) THEN
          RETURN NEW;
        END IF;

        -- (b) Erasure anonymisation: the row is detached from its user, the event is unchanged.
        IF OLD.user_id IS NOT NULL AND NEW.user_id IS NULL
           AND NEW.id = OLD.id
           AND NEW.created_at = OLD.created_at
           AND NEW.action = OLD.action
           AND NEW.resource IS NOT DISTINCT FROM OLD.resource
           AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
           AND NEW.original_organization_id IS NOT DISTINCT FROM OLD.original_organization_id
           AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
          RETURN NEW;
        END IF;

        RAISE EXCEPTION 'audit_logs rows are append-only'
          USING ERRCODE = 'insufficient_privilege';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "audit_logs_guard"
      BEFORE UPDATE OR DELETE ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION audit_logs_guard()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "audit_logs_guard" ON "audit_logs"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_logs_guard()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "audit_logs_set_original_organization" ON "audit_logs"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_logs_set_original_organization()`);

    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "fk_audit_logs_organization"`,
    );
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      ADD CONSTRAINT "fk_audit_logs_organization"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_logs_original_organization"`);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "original_organization_id"`,
    );
  }
}
