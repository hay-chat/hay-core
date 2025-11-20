import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWebchatSettings1763400000000 implements MigrationInterface {
  name = "CreateWebchatSettings1763400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create webchat_settings table
    await queryRunner.query(`
      CREATE TABLE webchat_settings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL,

        -- Appearance
        widget_title VARCHAR(100) NOT NULL DEFAULT 'Chat with us',
        widget_subtitle VARCHAR(200) DEFAULT 'We typically reply within minutes',
        position VARCHAR(10) NOT NULL DEFAULT 'right',
        theme VARCHAR(20) NOT NULL DEFAULT 'blue',

        -- Behavior
        show_greeting BOOLEAN NOT NULL DEFAULT true,
        greeting_message TEXT DEFAULT 'Hello! How can we help you today?',

        -- Security
        allowed_domains TEXT[] DEFAULT ARRAY['*']::TEXT[],
        is_enabled BOOLEAN NOT NULL DEFAULT true,

        -- Advanced
        custom_css TEXT,

        -- Timestamps
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

        -- Constraints
        CONSTRAINT fk_webchat_settings_organization
          FOREIGN KEY (organization_id)
          REFERENCES organizations(id)
          ON DELETE CASCADE,
        CONSTRAINT chk_position
          CHECK (position IN ('left', 'right')),
        CONSTRAINT chk_theme
          CHECK (theme IN ('blue', 'green', 'purple', 'black')),
        CONSTRAINT uq_webchat_settings_organization
          UNIQUE (organization_id)
      )
    `);

    // Create index for organization lookups
    await queryRunner.query(`
      CREATE INDEX idx_webchat_settings_organization_id
      ON webchat_settings(organization_id)
    `);

    // Create index for enabled status (for future queries filtering active widgets)
    await queryRunner.query(`
      CREATE INDEX idx_webchat_settings_enabled
      ON webchat_settings(is_enabled)
      WHERE is_enabled = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS idx_webchat_settings_enabled`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_webchat_settings_organization_id`);

    // Drop table
    await queryRunner.query(`DROP TABLE IF EXISTS webchat_settings`);
  }
}
