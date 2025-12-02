import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCustomPluginSupport1764683243709 implements MigrationInterface {
  name = "AddCustomPluginSupport1764683243709";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add columns to plugin_registry
    await queryRunner.query(`
      ALTER TABLE plugin_registry
      ADD COLUMN source_type VARCHAR(50) DEFAULT 'core' NOT NULL,
      ADD COLUMN organization_id UUID NULL,
      ADD COLUMN zip_file_path VARCHAR(1000) NULL,
      ADD COLUMN zip_upload_id UUID NULL,
      ADD COLUMN uploaded_by_id UUID NULL,
      ADD COLUMN uploaded_at TIMESTAMPTZ NULL
    `);

    // Add foreign keys
    await queryRunner.query(`
      ALTER TABLE plugin_registry
      ADD CONSTRAINT fk_plugin_registry_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE plugin_registry
      ADD CONSTRAINT fk_plugin_registry_zip_upload
      FOREIGN KEY (zip_upload_id) REFERENCES uploads(id) ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE plugin_registry
      ADD CONSTRAINT fk_plugin_registry_uploader
      FOREIGN KEY (uploaded_by_id) REFERENCES users(id) ON DELETE SET NULL
    `);

    // Add indexes for performance
    await queryRunner.query(`
      CREATE INDEX idx_plugin_registry_source_type ON plugin_registry(source_type)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_plugin_registry_organization_id ON plugin_registry(organization_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_plugin_registry_org_source ON plugin_registry(organization_id, source_type)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS idx_plugin_registry_org_source`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_plugin_registry_organization_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_plugin_registry_source_type`);

    // Drop foreign keys
    await queryRunner.query(
      `ALTER TABLE plugin_registry DROP CONSTRAINT IF EXISTS fk_plugin_registry_uploader`,
    );
    await queryRunner.query(
      `ALTER TABLE plugin_registry DROP CONSTRAINT IF EXISTS fk_plugin_registry_zip_upload`,
    );
    await queryRunner.query(
      `ALTER TABLE plugin_registry DROP CONSTRAINT IF EXISTS fk_plugin_registry_organization`,
    );

    // Drop columns
    await queryRunner.query(`
      ALTER TABLE plugin_registry
      DROP COLUMN IF EXISTS uploaded_at,
      DROP COLUMN IF EXISTS uploaded_by_id,
      DROP COLUMN IF EXISTS zip_upload_id,
      DROP COLUMN IF EXISTS zip_file_path,
      DROP COLUMN IF EXISTS organization_id,
      DROP COLUMN IF EXISTS source_type
    `);
  }
}
