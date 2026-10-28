import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D8-4: virus-scan state of an upload. NULL for files stored before the scan
 * existed and for non-conversation folders; "skipped" when no scanner is
 * configured or the type is not scanned; "pending" until clamd answers, then
 * "clean", "infected" or "error". Only pending/infected/error files are held.
 */
export class AddUploadScanStatus1785771000000 implements MigrationInterface {
  name = "AddUploadScanStatus1785771000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "scan_status" varchar(20)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "uploads" DROP COLUMN IF EXISTS "scan_status"`);
  }
}
