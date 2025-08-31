import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreatePluginTables1756638400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create plugin_registry table (global, org-agnostic)
    await queryRunner.createTable(
      new Table({
        name: "plugin_registry",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "name",
            type: "varchar",
            length: "255",
          },
          {
            name: "version",
            type: "varchar",
            length: "50",
          },
          {
            name: "manifest",
            type: "jsonb",
          },
          {
            name: "installed",
            type: "boolean",
            default: false,
          },
          {
            name: "built",
            type: "boolean",
            default: false,
          },
          {
            name: "last_install_error",
            type: "text",
            isNullable: true,
          },
          {
            name: "last_build_error",
            type: "text",
            isNullable: true,
          },
          {
            name: "installed_at",
            type: "timestamptz",
            isNullable: true,
          },
          {
            name: "built_at",
            type: "timestamptz",
            isNullable: true,
          },
          {
            name: "checksum",
            type: "varchar",
            length: "64",
            isNullable: true,
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "now()",
          },
          {
            name: "updated_at",
            type: "timestamptz",
            default: "now()",
          },
        ],
      }),
      true
    );

    // Create unique index on plugin name
    await queryRunner.createIndex(
      "plugin_registry",
      new TableIndex({
        name: "idx_plugin_registry_name",
        columnNames: ["name"],
        isUnique: true,
      })
    );

    // Create plugin_instances table (org-scoped)
    await queryRunner.createTable(
      new Table({
        name: "plugin_instances",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "organization_id",
            type: "uuid",
          },
          {
            name: "plugin_id",
            type: "uuid",
          },
          {
            name: "enabled",
            type: "boolean",
            default: false,
          },
          {
            name: "config",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "running",
            type: "boolean",
            default: false,
          },
          {
            name: "process_id",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "last_started_at",
            type: "timestamptz",
            isNullable: true,
          },
          {
            name: "last_stopped_at",
            type: "timestamptz",
            isNullable: true,
          },
          {
            name: "last_error",
            type: "text",
            isNullable: true,
          },
          {
            name: "restart_count",
            type: "integer",
            default: 0,
          },
          {
            name: "last_health_check",
            type: "timestamptz",
            isNullable: true,
          },
          {
            name: "status",
            type: "varchar",
            length: "50",
            default: "'stopped'",
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "now()",
          },
          {
            name: "updated_at",
            type: "timestamptz",
            default: "now()",
          },
          {
            name: "created_by",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "updated_by",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
        ],
        foreignKeys: [
          {
            columnNames: ["organization_id"],
            referencedTableName: "organizations",
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
          },
          {
            columnNames: ["plugin_id"],
            referencedTableName: "plugin_registry",
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
          },
        ],
      }),
      true
    );

    // Create composite unique index on organizationId and pluginId
    await queryRunner.createIndex(
      "plugin_instances",
      new TableIndex({
        name: "idx_plugin_instances_org_plugin",
        columnNames: ["organization_id", "plugin_id"],
        isUnique: true,
      })
    );

    // Create index on organization_id for faster lookups
    await queryRunner.createIndex(
      "plugin_instances",
      new TableIndex({
        name: "idx_plugin_instances_org",
        columnNames: ["organization_id"],
      })
    );

    // Create index on enabled for faster filtering
    await queryRunner.createIndex(
      "plugin_instances",
      new TableIndex({
        name: "idx_plugin_instances_enabled",
        columnNames: ["enabled"],
      })
    );

    // Create index on status for monitoring queries
    await queryRunner.createIndex(
      "plugin_instances",
      new TableIndex({
        name: "idx_plugin_instances_status",
        columnNames: ["status"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex("plugin_instances", "idx_plugin_instances_status");
    await queryRunner.dropIndex("plugin_instances", "idx_plugin_instances_enabled");
    await queryRunner.dropIndex("plugin_instances", "idx_plugin_instances_org");
    await queryRunner.dropIndex("plugin_instances", "idx_plugin_instances_org_plugin");
    await queryRunner.dropIndex("plugin_registry", "idx_plugin_registry_name");

    // Drop tables
    await queryRunner.dropTable("plugin_instances");
    await queryRunner.dropTable("plugin_registry");
  }
}