import { MigrationInterface, QueryRunner } from "typeorm";

const PERSONAL_CHANGES_ACTIONS = `ARRAY[
  'email.change',
  'organization.invitation.send',
  'organization.invitation.accept',
  'organization.invitation.decline',
  'organization.invitation.cancel',
  'organization.invitation.resend',
  'organization.member.remove'
]`;

/** Roles other than the owner allowed to run the purge, which a signature change would drop. */
async function purgeGrantees(queryRunner: QueryRunner): Promise<string[]> {
  const rows: Array<{ rolname: string }> = await queryRunner.query(`
    SELECT DISTINCT r.rolname
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) a
    JOIN pg_roles r ON r.oid = a.grantee
    WHERE p.proname = 'audit_logs_purge'
      AND a.privilege_type = 'EXECUTE'
      AND a.grantee <> p.proowner
  `);
  return rows.map((row) => row.rolname);
}

async function grantPurge(
  queryRunner: QueryRunner,
  signature: string,
  roles: string[],
): Promise<void> {
  for (const role of roles) {
    const quoted = `"${role.replace(/"/g, '""')}"`;
    await queryRunner.query(
      `GRANT EXECUTE ON FUNCTION audit_logs_purge(${signature}) TO ${quoted}`,
    );
  }
}

/**
 * Outbox for shipping audit rows to append-only external storage.
 *
 * - An AFTER INSERT trigger queues every chained row in the inserting
 *   transaction, so a row is either committed with its outbox entry or not at all.
 * - `audit_logs_purge` takes `require_shipped`: with it set, a row whose outbox
 *   entry is not shipped is kept, and so is every later row of its chain, so
 *   what remains stays contiguous. Outbox entries go with the rows they name.
 * - Existing chained rows are queued once so enabling the sink later ships them.
 *
 * Nothing reads the outbox unless the sink is configured, and the application
 * does not touch it while this migration is pending.
 */
export class AddAuditLogOutbox1794300000000 implements MigrationInterface {
  name = "AddAuditLogOutbox1794300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_log_outbox" (
        "audit_log_id" uuid PRIMARY KEY,
        "chain_key" uuid NOT NULL,
        "chain_seq" bigint NOT NULL,
        "queued_at" timestamptz NOT NULL DEFAULT now(),
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
        "last_error" varchar(200),
        "shipped_at" timestamptz,
        "failed_at" timestamptz
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_audit_log_outbox_pending"
      ON "audit_log_outbox" ("next_attempt_at")
      WHERE "shipped_at" IS NULL AND "failed_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_audit_log_outbox_failed"
      ON "audit_log_outbox" ("failed_at")
      WHERE "failed_at" IS NOT NULL AND "shipped_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_logs_outbox_enqueue() RETURNS trigger AS $$
      BEGIN
        IF NEW.chain_seq IS NOT NULL THEN
          INSERT INTO audit_log_outbox (audit_log_id, chain_key, chain_seq)
          VALUES (NEW.id, NEW.chain_key, NEW.chain_seq)
          ON CONFLICT (audit_log_id) DO NOTHING;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "audit_logs_outbox" ON "audit_logs"`);
    await queryRunner.query(`
      CREATE TRIGGER "audit_logs_outbox"
      AFTER INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION audit_logs_outbox_enqueue()
    `);

    await queryRunner.query(`
      INSERT INTO audit_log_outbox (audit_log_id, chain_key, chain_seq)
      SELECT id, chain_key, chain_seq FROM audit_logs WHERE chain_seq IS NOT NULL
      ON CONFLICT (audit_log_id) DO NOTHING
    `);

    const grantees = await purgeGrantees(queryRunner);
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_logs_purge(timestamptz, timestamptz)`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_logs_purge(
        delete_before timestamptz, scrub_before timestamptz, require_shipped boolean DEFAULT false
      ) RETURNS bigint AS $$
      DECLARE
        deleted bigint;
      BEGIN
        PERFORM set_config('hay.audit_logs_purge', 'on', true);

        UPDATE audit_logs
          SET ip_address = NULL,
              user_agent = NULL,
              changes = CASE WHEN action = ANY(${PERSONAL_CHANGES_ACTIONS}) THEN NULL ELSE changes END
          WHERE created_at < scrub_before
            AND (ip_address IS NOT NULL OR user_agent IS NOT NULL
                 OR (changes IS NOT NULL AND action = ANY(${PERSONAL_CHANGES_ACTIONS})));

        -- Only a chain's oldest rows may go. A row is kept while an earlier
        -- sequence is still inside retention (or, with require_shipped, not yet
        -- shipped), so what remains stays contiguous.
        WITH held AS (
          SELECT l.id, l.chain_key, l.chain_seq
          FROM audit_logs l
          WHERE l.chain_seq IS NOT NULL
            AND (l.created_at >= delete_before
                 OR (require_shipped AND EXISTS (
                   SELECT 1 FROM audit_log_outbox o
                   WHERE o.audit_log_id = l.id AND o.shipped_at IS NULL
                 )))
        ), floors AS (
          SELECT h.chain_key, min(h.chain_seq) AS floor_seq FROM held h GROUP BY h.chain_key
        ), removed AS (
          DELETE FROM audit_logs a
          WHERE a.created_at < delete_before
            AND NOT EXISTS (SELECT 1 FROM held h WHERE h.id = a.id)
            AND NOT EXISTS (
              SELECT 1 FROM floors f WHERE f.chain_key = a.chain_key AND a.chain_seq > f.floor_seq
            )
          RETURNING a.id, a.chain_key, a.chain_seq
        ), advanced AS (
          UPDATE audit_log_chain_heads h
            SET purged_through = GREATEST(h.purged_through, m.top_seq)
            FROM (
              SELECT r.chain_key, max(r.chain_seq) AS top_seq
              FROM removed r WHERE r.chain_seq IS NOT NULL GROUP BY r.chain_key
            ) m
            WHERE h.chain_key = m.chain_key
            RETURNING 1
        ), dequeued AS (
          DELETE FROM audit_log_outbox o USING removed r WHERE o.audit_log_id = r.id RETURNING 1
        )
        SELECT count(*) INTO deleted FROM removed;

        PERFORM set_config('hay.audit_logs_purge', 'off', true);
        RETURN deleted;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    `);
    await queryRunner.query(
      `REVOKE EXECUTE ON FUNCTION audit_logs_purge(timestamptz, timestamptz, boolean) FROM PUBLIC`,
    );
    await grantPurge(queryRunner, "timestamptz, timestamptz, boolean", grantees);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const grantees = await purgeGrantees(queryRunner);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS audit_logs_purge(timestamptz, timestamptz, boolean)`,
    );
    // Restores the function as AuditLogHashChain defined it.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_logs_purge(delete_before timestamptz, scrub_before timestamptz)
      RETURNS bigint AS $$
      DECLARE
        deleted bigint;
      BEGIN
        PERFORM set_config('hay.audit_logs_purge', 'on', true);

        UPDATE audit_logs
          SET ip_address = NULL,
              user_agent = NULL,
              changes = CASE WHEN action = ANY(${PERSONAL_CHANGES_ACTIONS}) THEN NULL ELSE changes END
          WHERE created_at < scrub_before
            AND (ip_address IS NOT NULL OR user_agent IS NOT NULL
                 OR (changes IS NOT NULL AND action = ANY(${PERSONAL_CHANGES_ACTIONS})));

        WITH floors AS (
          SELECT l.chain_key, min(l.chain_seq) AS floor_seq
          FROM audit_logs l
          WHERE l.created_at >= delete_before AND l.chain_seq IS NOT NULL
          GROUP BY l.chain_key
        ), removed AS (
          DELETE FROM audit_logs a
          WHERE a.created_at < delete_before
            AND NOT EXISTS (
              SELECT 1 FROM floors f WHERE f.chain_key = a.chain_key AND a.chain_seq > f.floor_seq
            )
          RETURNING a.chain_key, a.chain_seq
        ), advanced AS (
          UPDATE audit_log_chain_heads h
            SET purged_through = GREATEST(h.purged_through, m.top_seq)
            FROM (
              SELECT r.chain_key, max(r.chain_seq) AS top_seq
              FROM removed r WHERE r.chain_seq IS NOT NULL GROUP BY r.chain_key
            ) m
            WHERE h.chain_key = m.chain_key
            RETURNING 1
        )
        SELECT count(*) INTO deleted FROM removed;

        PERFORM set_config('hay.audit_logs_purge', 'off', true);
        RETURN deleted;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    `);
    await queryRunner.query(
      `REVOKE EXECUTE ON FUNCTION audit_logs_purge(timestamptz, timestamptz) FROM PUBLIC`,
    );
    await grantPurge(queryRunner, "timestamptz, timestamptz", grantees);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "audit_logs_outbox" ON "audit_logs"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_logs_outbox_enqueue()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_log_outbox"`);
  }
}
