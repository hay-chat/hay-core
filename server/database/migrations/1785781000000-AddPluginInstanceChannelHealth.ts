import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D13-11: `plugin_instances.channel_health`, the generic "channel failing"
 * signal for channel plugins: {status: "ok" | "failing", reason, detail,
 * since, lastAlertAt}. Set by core (repeated failed deliveries, revoked
 * connection) or by the plugin (`channel.reportHealth`, e.g. a WhatsApp
 * quality drop). Null = never reported.
 */
export class AddPluginInstanceChannelHealth1785781000000 implements MigrationInterface {
  name = "AddPluginInstanceChannelHealth1785781000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "plugin_instances" ADD COLUMN IF NOT EXISTS "channel_health" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "plugin_instances" DROP COLUMN IF EXISTS "channel_health"`,
    );
  }
}
