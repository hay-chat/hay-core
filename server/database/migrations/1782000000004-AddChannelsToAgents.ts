import { MigrationInterface, QueryRunner } from "typeorm";

export class AddChannelsToAgents1782000000004 implements MigrationInterface {
  name = "AddChannelsToAgents1782000000004";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Per-channel agent routing (many-to-many): an agent can be assigned to many
    // channels and a channel can be claimed by many agents. Channel ids are the
    // canonical plugin manifest.channel strings (e.g. 'instagram') plus 'web'.
    // Replaces the unused organization.settings.channelAgents scaffolding.
    await queryRunner.query(`ALTER TABLE "agents" ADD "channels" text array NOT NULL DEFAULT '{}'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agents" DROP COLUMN "channels"`);
  }
}
