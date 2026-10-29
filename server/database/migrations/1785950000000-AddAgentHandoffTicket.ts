import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * "When no one is available → create a ticket": the helpdesk plugin and the
 * prefilled ticket fields per agent. Null = follow the free-text instructions.
 */
export class AddAgentHandoffTicket1785950000000 implements MigrationInterface {
  name = "AddAgentHandoffTicket1785950000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "human_handoff_unavailable_ticket" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agents" DROP COLUMN IF EXISTS "human_handoff_unavailable_ticket"`,
    );
  }
}
