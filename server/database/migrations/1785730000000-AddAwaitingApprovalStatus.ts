import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D4-4: `awaiting-approval` conversation status. The AI asked a person to
 * approve a write action and is waiting for the decision. The inactivity close
 * only looks at `open` conversations, so these are never auto-closed.
 */
export class AddAwaitingApprovalStatus1785730000000 implements MigrationInterface {
  name = "AddAwaitingApprovalStatus1785730000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "conversations_status_enum" ADD VALUE IF NOT EXISTS 'awaiting-approval';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL cannot drop an enum value without recreating the type. Move
    // rows off it so the old code still reads them; the value stays.
    await queryRunner.query(`
      UPDATE "conversations" SET "status" = 'pending-human' WHERE "status" = 'awaiting-approval';
    `);
  }
}
