import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Records who performed an audit event: a user, an API key, a plugin or the
 * system. Filled by a BEFORE INSERT trigger, so the application keeps working
 * while this migration is pending. Existing rows stay NULL (no backfill).
 */
export class AddAuditLogActor1793810000000 implements MigrationInterface {
  name = "AddAuditLogActor1793810000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actor_type" varchar(20)`,
    );
    await queryRunner.query(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "api_key_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_audit_logs_api_key" ON "audit_logs" ("api_key_id")`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_logs_set_actor() RETURNS trigger AS $$
      DECLARE
        claimed_actor text := NEW.metadata->>'actorType';
      BEGIN
        NEW.actor_type := CASE
          WHEN claimed_actor IN ('user', 'apikey', 'plugin', 'system') THEN claimed_actor
          WHEN NEW.user_id IS NOT NULL THEN 'user'
          ELSE 'system'
        END;
        IF NEW.metadata->>'apiKeyId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          NEW.api_key_id := (NEW.metadata->>'apiKeyId')::uuid;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "audit_logs_set_actor" ON "audit_logs"`);
    await queryRunner.query(`
      CREATE TRIGGER "audit_logs_set_actor"
      BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION audit_logs_set_actor()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "audit_logs_set_actor" ON "audit_logs"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_logs_set_actor()`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_logs_api_key"`);
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "api_key_id"`);
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "actor_type"`);
  }
}
