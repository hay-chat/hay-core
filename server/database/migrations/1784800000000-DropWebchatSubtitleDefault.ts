import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The old default subtitle promised a reply time Hay.chat cannot guarantee.
 * Drop the column default and clear rows that still hold it untouched, so the
 * widget falls back to its neutral, localised subtitle.
 */
export class DropWebchatSubtitleDefault1784800000000 implements MigrationInterface {
  name = "DropWebchatSubtitleDefault1784800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        ALTER COLUMN "widget_subtitle" DROP DEFAULT;
    `);

    await queryRunner.query(`
      UPDATE "webchat_settings"
      SET "widget_subtitle" = NULL
      WHERE LOWER(TRIM("widget_subtitle")) = 'we typically reply within minutes';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        ALTER COLUMN "widget_subtitle" SET DEFAULT 'We typically reply within minutes';
    `);
  }
}
