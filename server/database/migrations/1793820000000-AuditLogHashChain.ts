import { MigrationInterface, QueryRunner } from "typeorm";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const PERSONAL_CHANGES_ACTIONS = `ARRAY[
  'email.change',
  'organization.invitation.send',
  'organization.invitation.accept',
  'organization.invitation.decline',
  'organization.invitation.cancel',
  'organization.invitation.resend',
  'organization.member.remove'
]`;

/**
 * Makes alteration of the audit trail detectable and narrows who can purge it.
 *
 * - Each organization (rows without one share the zero uuid) has its own hash
 *   chain, extended by a BEFORE INSERT trigger under a per-chain row lock. The
 *   hash covers the fields of the event that never change. Personal fields (ip,
 *   user agent, changes, metadata, user id) are deliberately outside it, so
 *   erasure and retention scrubbing leave the chain valid.
 * - `audit_log_chain_heads` remembers each chain's last and last purged
 *   sequence, so removing the newest or oldest rows shows up too.
 * - Retention goes through `audit_logs_purge`, a SECURITY DEFINER function. The
 *   guard only honours its purge flag when running as the table owner.
 *
 * Existing rows stay outside the chain (NULL chain columns, no backfill). The
 * trigger assigns every chain column, so the application is unaffected while
 * this migration is pending.
 */
export class AuditLogHashChain1793820000000 implements MigrationInterface {
  name = "AuditLogHashChain1793820000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
        ADD COLUMN IF NOT EXISTS "chain_key" uuid,
        ADD COLUMN IF NOT EXISTS "chain_seq" bigint,
        ADD COLUMN IF NOT EXISTS "prev_hash" varchar(64),
        ADD COLUMN IF NOT EXISTS "hash" varchar(64)
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_audit_logs_chain" ON "audit_logs" ("chain_key", "chain_seq")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_log_chain_heads" (
        "chain_key" uuid PRIMARY KEY,
        "last_seq" bigint NOT NULL DEFAULT 0,
        "last_hash" varchar(64),
        "purged_through" bigint NOT NULL DEFAULT 0
      )
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_logs_chain_hash(
        prev_hash text, chain_key uuid, chain_seq bigint, id uuid, created_at timestamptz,
        action text, resource text, original_organization_id uuid, status text,
        actor_type text, api_key_id uuid
      ) RETURNS varchar(64) AS $$
        SELECT encode(sha256(convert_to(jsonb_build_array(
          prev_hash, chain_key, chain_seq, id,
          (extract(epoch FROM created_at) * 1000000)::bigint,
          action, resource, original_organization_id, status, actor_type, api_key_id
        )::text, 'UTF8')), 'hex')
      $$ LANGUAGE sql IMMUTABLE
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_logs_chain() RETURNS trigger AS $$
      DECLARE
        head audit_log_chain_heads%ROWTYPE;
      BEGIN
        NEW.chain_key := COALESCE(NEW.original_organization_id, NEW.organization_id, '${ZERO_UUID}'::uuid);

        INSERT INTO audit_log_chain_heads (chain_key) VALUES (NEW.chain_key)
          ON CONFLICT (chain_key) DO NOTHING;
        SELECT * INTO head FROM audit_log_chain_heads h WHERE h.chain_key = NEW.chain_key FOR UPDATE;

        NEW.chain_seq := head.last_seq + 1;
        NEW.prev_hash := head.last_hash;
        NEW.hash := audit_logs_chain_hash(
          NEW.prev_hash, NEW.chain_key, NEW.chain_seq, NEW.id, NEW.created_at,
          NEW.action, NEW.resource, NEW.original_organization_id, NEW.status,
          NEW.actor_type, NEW.api_key_id
        );

        UPDATE audit_log_chain_heads h
          SET last_seq = NEW.chain_seq, last_hash = NEW.hash
          WHERE h.chain_key = NEW.chain_key;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    `);
    // Named to fire last: BEFORE triggers run alphabetically, and the hash covers
    // the values the actor and original-organization triggers assign.
    await queryRunner.query(`DROP TRIGGER IF EXISTS "audit_logs_zz_chain" ON "audit_logs"`);
    await queryRunner.query(`
      CREATE TRIGGER "audit_logs_zz_chain"
      BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION audit_logs_chain()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger AS $$
      DECLARE
        purge_allowed boolean := current_setting('hay.audit_logs_purge', true) = 'on'
          AND current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID);
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF purge_allowed THEN
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
           AND NEW.status IS NOT DISTINCT FROM OLD.status
           AND NEW.actor_type IS NOT DISTINCT FROM OLD.actor_type
           AND NEW.api_key_id IS NOT DISTINCT FROM OLD.api_key_id
           AND NEW.chain_key IS NOT DISTINCT FROM OLD.chain_key
           AND NEW.chain_seq IS NOT DISTINCT FROM OLD.chain_seq
           AND NEW.prev_hash IS NOT DISTINCT FROM OLD.prev_hash
           AND NEW.hash IS NOT DISTINCT FROM OLD.hash THEN
          RETURN NEW;
        END IF;

        -- (c) Retention scrub: personal fields are cleared, nothing else changes.
        IF purge_allowed
           AND (to_jsonb(NEW) - 'ip_address' - 'user_agent' - 'changes') = (to_jsonb(OLD) - 'ip_address' - 'user_agent' - 'changes')
           AND (NEW.ip_address IS NULL OR NEW.ip_address = OLD.ip_address)
           AND (NEW.user_agent IS NULL OR NEW.user_agent = OLD.user_agent)
           AND (NEW.changes IS NULL OR NEW.changes = OLD.changes) THEN
          RETURN NEW;
        END IF;

        RAISE EXCEPTION 'audit_logs rows are append-only'
          USING ERRCODE = 'insufficient_privilege';
      END;
      $$ LANGUAGE plpgsql
    `);

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

        -- Only a chain's oldest rows may go. A row is kept while an earlier
        -- sequence is still inside retention, so what remains stays contiguous.
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

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_logs_verify_chain(only_chain uuid DEFAULT NULL)
      RETURNS TABLE (chain_key uuid, chain_seq bigint, problem text) AS $$
        WITH chained AS (
          SELECT l.*,
            lag(l.chain_seq) OVER w AS previous_seq,
            lag(l.hash) OVER w AS previous_hash,
            row_number() OVER w AS position_in_chain,
            max(l.chain_seq) OVER (PARTITION BY l.chain_key) AS newest_seq
          FROM audit_logs l
          WHERE l.chain_seq IS NOT NULL AND (only_chain IS NULL OR l.chain_key = only_chain)
          WINDOW w AS (PARTITION BY l.chain_key ORDER BY l.chain_seq)
        )
        SELECT c.chain_key, c.chain_seq, 'hash_mismatch'
          FROM chained c
          WHERE c.hash IS DISTINCT FROM audit_logs_chain_hash(
            c.prev_hash, c.chain_key, c.chain_seq, c.id, c.created_at,
            c.action, c.resource, c.original_organization_id, c.status,
            c.actor_type, c.api_key_id
          )
        UNION ALL
        SELECT c.chain_key, c.chain_seq, 'prev_hash_mismatch'
          FROM chained c
          WHERE c.previous_seq IS NOT NULL AND c.prev_hash IS DISTINCT FROM c.previous_hash
        UNION ALL
        SELECT c.chain_key, c.chain_seq, 'sequence_gap'
          FROM chained c
          WHERE c.previous_seq IS NOT NULL AND c.chain_seq <> c.previous_seq + 1
        UNION ALL
        SELECT c.chain_key, c.chain_seq, 'missing_oldest_rows'
          FROM chained c
          JOIN audit_log_chain_heads h ON h.chain_key = c.chain_key
          WHERE c.position_in_chain = 1 AND c.chain_seq <> h.purged_through + 1
        UNION ALL
        SELECT h.chain_key, h.last_seq, 'missing_newest_rows'
          FROM audit_log_chain_heads h
          WHERE (only_chain IS NULL OR h.chain_key = only_chain)
            AND h.last_seq > h.purged_through
            AND h.last_seq IS DISTINCT FROM (
              SELECT max(c.newest_seq) FROM chained c WHERE c.chain_key = h.chain_key
            )
      $$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    `);
    await queryRunner.query(`REVOKE EXECUTE ON FUNCTION audit_logs_verify_chain(uuid) FROM PUBLIC`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_logs_verify_chain(uuid)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_logs_purge(timestamptz, timestamptz)`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "audit_logs_zz_chain" ON "audit_logs"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_logs_chain()`);
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS audit_logs_chain_hash(
        text, uuid, bigint, uuid, timestamptz, text, text, uuid, text, text, uuid
      )
    `);

    // Restores the guard as HardenAuditLogs defined it. This must run before the
    // columns go, because plpgsql resolves NEW.chain_key at execution.
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

    await queryRunner.query(`DROP TABLE IF EXISTS "audit_log_chain_heads"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_audit_logs_chain"`);
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
        DROP COLUMN IF EXISTS "hash",
        DROP COLUMN IF EXISTS "prev_hash",
        DROP COLUMN IF EXISTS "chain_seq",
        DROP COLUMN IF EXISTS "chain_key"
    `);
  }
}
