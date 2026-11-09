import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * - storage_purge_queue: stored objects to delete once their upload rows are
 *   gone (no foreign keys, entries outlive the organization).
 * - privacy_requests survive their organization: the foreign key becomes
 *   SET NULL and original_organization_id keeps the id, as in audit_logs.
 */
export class AddStoragePurgeQueueAndKeepPrivacyRequests1793950000000 implements MigrationInterface {
  name = "AddStoragePurgeQueueAndKeepPrivacyRequests1793950000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "storage_purge_queue" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "storage_path" varchar(1000) NOT NULL,
        "storage_type" varchar NOT NULL,
        "reason" varchar(64) NOT NULL,
        "attempts" int NOT NULL DEFAULT 0,
        "last_attempt_at" timestamptz NULL,
        "last_error" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_storage_purge_queue" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_storage_purge_queue_created_at" ON "storage_purge_queue" ("created_at")`,
    );

    await queryRunner.query(
      `ALTER TABLE "privacy_requests" ADD COLUMN IF NOT EXISTS "original_organization_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "privacy_requests" SET "original_organization_id" = "organization_id"
       WHERE "organization_id" IS NOT NULL AND "original_organization_id" IS NULL`,
    );
    await this.replaceOrganizationForeignKey(queryRunner, "SET NULL");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.replaceOrganizationForeignKey(queryRunner, "CASCADE");
    await queryRunner.query(
      `ALTER TABLE "privacy_requests" DROP COLUMN IF EXISTS "original_organization_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "storage_purge_queue"`);
  }

  private async replaceOrganizationForeignKey(
    queryRunner: QueryRunner,
    onDelete: "SET NULL" | "CASCADE",
  ): Promise<void> {
    const constraints: Array<{ conname: string }> = await queryRunner.query(
      `SELECT con.conname
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
       WHERE con.contype = 'f' AND rel.relname = 'privacy_requests'
         AND att.attname = 'organization_id'`,
    );
    for (const { conname } of constraints) {
      await queryRunner.query(`ALTER TABLE "privacy_requests" DROP CONSTRAINT "${conname}"`);
    }
    await queryRunner.query(
      `ALTER TABLE "privacy_requests" ADD CONSTRAINT "FK_e638a389d49f2f3516c12a551f4"
       FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE ${onDelete}`,
    );
  }
}
