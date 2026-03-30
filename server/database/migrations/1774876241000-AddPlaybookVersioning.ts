import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPlaybookVersioning1774876241000 implements MigrationInterface {
  name = "AddPlaybookVersioning1774876241000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Create playbook_versions table
    await queryRunner.query(`
      CREATE TABLE "playbook_versions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "playbook_id" uuid NOT NULL,
        "version_number" integer NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'draft',
        "instructions" jsonb,
        "prompt_template" text,
        "required_fields" jsonb,
        "publish_note" text,
        "created_by_id" uuid,
        "published_by_id" uuid,
        "published_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_playbook_versions" PRIMARY KEY ("id")
      )
    `);

    // Step 2: Add foreign key constraints
    await queryRunner.query(`
      ALTER TABLE "playbook_versions"
        ADD CONSTRAINT "fk_playbook_versions_playbook"
        FOREIGN KEY ("playbook_id") REFERENCES "playbooks"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "playbook_versions"
        ADD CONSTRAINT "fk_playbook_versions_created_by"
        FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "playbook_versions"
        ADD CONSTRAINT "fk_playbook_versions_published_by"
        FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // Step 3: Add indexes
    await queryRunner.query(`
      CREATE INDEX "idx_playbook_versions_playbook_id"
        ON "playbook_versions"("playbook_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_playbook_versions_playbook_status"
        ON "playbook_versions"("playbook_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_playbook_versions_playbook_version_number"
        ON "playbook_versions"("playbook_id", "version_number")
    `);

    // Partial unique indexes to enforce one draft and one active per playbook
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_playbook_versions_playbook_draft"
        ON "playbook_versions"("playbook_id") WHERE status = 'draft'
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_playbook_versions_playbook_active"
        ON "playbook_versions"("playbook_id") WHERE status = 'active'
    `);

    // Step 4: Add version pointer columns to playbooks
    await queryRunner.query(`
      ALTER TABLE "playbooks"
        ADD COLUMN "active_version_id" uuid,
        ADD COLUMN "draft_version_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "playbooks"
        ADD CONSTRAINT "fk_playbooks_active_version"
        FOREIGN KEY ("active_version_id") REFERENCES "playbook_versions"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "playbooks"
        ADD CONSTRAINT "fk_playbooks_draft_version"
        FOREIGN KEY ("draft_version_id") REFERENCES "playbook_versions"("id") ON DELETE SET NULL
    `);

    // Step 5: Add playbook_version_id to conversations
    await queryRunner.query(`
      ALTER TABLE "conversations"
        ADD COLUMN "playbook_version_id" uuid
    `);

    // Step 6: Data migration — create version rows from existing playbooks
    // For ACTIVE playbooks: create an active version
    await queryRunner.query(`
      INSERT INTO "playbook_versions" (
        "playbook_id", "version_number", "status",
        "instructions", "prompt_template", "required_fields",
        "published_at", "created_at", "updated_at"
      )
      SELECT
        "id", 1, 'active',
        "instructions", "prompt_template", "required_fields",
        now(), "created_at", "updated_at"
      FROM "playbooks"
      WHERE "status" = 'active'
    `);

    // For DRAFT playbooks: create a draft version
    await queryRunner.query(`
      INSERT INTO "playbook_versions" (
        "playbook_id", "version_number", "status",
        "instructions", "prompt_template", "required_fields",
        "created_at", "updated_at"
      )
      SELECT
        "id", 1, 'draft',
        "instructions", "prompt_template", "required_fields",
        "created_at", "updated_at"
      FROM "playbooks"
      WHERE "status" = 'draft'
    `);

    // For ARCHIVED playbooks: create an archived version
    await queryRunner.query(`
      INSERT INTO "playbook_versions" (
        "playbook_id", "version_number", "status",
        "instructions", "prompt_template", "required_fields",
        "created_at", "updated_at"
      )
      SELECT
        "id", 1, 'archived',
        "instructions", "prompt_template", "required_fields",
        "created_at", "updated_at"
      FROM "playbooks"
      WHERE "status" = 'archived'
    `);

    // Step 7: Set active_version_id pointers
    await queryRunner.query(`
      UPDATE "playbooks" p
      SET "active_version_id" = pv."id"
      FROM "playbook_versions" pv
      WHERE pv."playbook_id" = p."id" AND pv."status" = 'active'
    `);

    // Set draft_version_id pointers
    await queryRunner.query(`
      UPDATE "playbooks" p
      SET "draft_version_id" = pv."id"
      FROM "playbook_versions" pv
      WHERE pv."playbook_id" = p."id" AND pv."status" = 'draft'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove playbook_version_id from conversations
    await queryRunner.query(`
      ALTER TABLE "conversations" DROP COLUMN IF EXISTS "playbook_version_id"
    `);

    // Remove version pointer columns and FKs from playbooks
    await queryRunner.query(`
      ALTER TABLE "playbooks" DROP CONSTRAINT IF EXISTS "fk_playbooks_active_version"
    `);
    await queryRunner.query(`
      ALTER TABLE "playbooks" DROP CONSTRAINT IF EXISTS "fk_playbooks_draft_version"
    `);
    await queryRunner.query(`
      ALTER TABLE "playbooks"
        DROP COLUMN IF EXISTS "active_version_id",
        DROP COLUMN IF EXISTS "draft_version_id"
    `);

    // Drop playbook_versions table (cascade handles FKs)
    await queryRunner.query(`DROP TABLE IF EXISTS "playbook_versions" CASCADE`);
  }
}
