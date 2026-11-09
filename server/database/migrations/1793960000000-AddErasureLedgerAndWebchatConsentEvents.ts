import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * - erasure_ledger: append-only list of erased subjects (ids only, no foreign
 *   keys), replayed after a backup restore.
 * - webchat_consent_events: the consent decisions host pages report through the
 *   widget.
 */
export class AddErasureLedgerAndWebchatConsentEvents1793960000000 implements MigrationInterface {
  name = "AddErasureLedgerAndWebchatConsentEvents1793960000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "erasure_ledger" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "subject_type" varchar(16) NOT NULL
          CONSTRAINT "chk_erasure_ledger_subject_type"
          CHECK ("subject_type" IN ('customer', 'user', 'organization')),
        "subject_id" uuid NOT NULL,
        "organization_id" uuid NULL,
        "erased_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_erasure_ledger" PRIMARY KEY ("id"),
        CONSTRAINT "uq_erasure_ledger_subject" UNIQUE ("subject_type", "subject_id")
      )
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION erasure_ledger_append_only() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'erasure_ledger is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_erasure_ledger_append_only" ON "erasure_ledger"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "trg_erasure_ledger_append_only"
      BEFORE UPDATE OR DELETE ON "erasure_ledger"
      FOR EACH ROW EXECUTE FUNCTION erasure_ledger_append_only()
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webchat_consent_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "conversation_id" uuid NULL,
        "action" varchar(16) NOT NULL
          CONSTRAINT "chk_webchat_consent_events_action" CHECK ("action" IN ('grant', 'revoke')),
        "mode" varchar(16) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_webchat_consent_events" PRIMARY KEY ("id"),
        CONSTRAINT "fk_webchat_consent_events_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_webchat_consent_events_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_webchat_consent_events_org_created"
        ON "webchat_consent_events" ("organization_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_webchat_consent_events_conversation"
        ON "webchat_consent_events" ("conversation_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "webchat_consent_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "erasure_ledger"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS erasure_ledger_append_only()`);
  }
}
