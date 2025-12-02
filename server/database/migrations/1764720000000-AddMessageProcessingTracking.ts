import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMessageProcessingTracking1764720000000 implements MigrationInterface {
  name = "AddMessageProcessingTracking1764720000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add processing attempt tracking fields
    await queryRunner.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS processing_attempts INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_processing_error TEXT NULL,
      ADD COLUMN IF NOT EXISTS last_processing_error_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS processing_error_count INTEGER DEFAULT 0
    `);

    // Add recovery tracking fields
    await queryRunner.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS last_recovery_attempt_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS recovery_attempts INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_stuck BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS stuck_detected_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS stuck_reason TEXT NULL
    `);

    // Create optimized index for stale detection query
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_stale_detection
      ON conversations (status, needs_processing, last_message_at, processing_locked_until, is_stuck)
      WHERE status IN ('open', 'processing')
    `);

    // Initialize existing conversations with default values
    await queryRunner.query(`
      UPDATE conversations
      SET
        processing_attempts = 0,
        processing_error_count = 0,
        recovery_attempts = 0,
        is_stuck = FALSE
      WHERE processing_attempts IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_conversations_stale_detection
    `);

    // Drop processing tracking columns
    await queryRunner.query(`
      ALTER TABLE conversations
      DROP COLUMN IF EXISTS processing_attempts,
      DROP COLUMN IF EXISTS last_processing_error,
      DROP COLUMN IF EXISTS last_processing_error_at,
      DROP COLUMN IF EXISTS processing_error_count
    `);

    // Drop recovery tracking columns
    await queryRunner.query(`
      ALTER TABLE conversations
      DROP COLUMN IF EXISTS last_recovery_attempt_at,
      DROP COLUMN IF EXISTS recovery_attempts,
      DROP COLUMN IF EXISTS is_stuck,
      DROP COLUMN IF EXISTS stuck_detected_at,
      DROP COLUMN IF EXISTS stuck_reason
    `);
  }
}
