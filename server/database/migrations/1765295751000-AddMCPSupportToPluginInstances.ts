import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add MCP Support to Plugin Instances
 *
 * This migration adds support for MCP (Model Context Protocol) servers in plugin instances.
 * Since plugin_instances.config is JSONB, we don't need schema changes - just documenting
 * the new fields that will be stored in the config object.
 *
 * New config structure:
 * {
 *   // ... existing config fields
 *   mcpServers?: {
 *     local?: Array<{
 *       serverId: string;
 *       serverPath: string;
 *       startCommand: string;
 *       installCommand?: string;
 *       buildCommand?: string;
 *       tools: Array<{ name: string; description: string; input_schema: any }>;
 *       env?: Record<string, string>;
 *     }>;
 *     remote?: Array<{
 *       serverId: string;
 *       url: string;
 *       transport: "http" | "sse" | "websocket";
 *       auth?: { type: "bearer" | "apiKey"; token?: string; apiKey?: string };
 *       tools: Array<{ name: string; description: string; input_schema: any }>;
 *     }>;
 *   }
 * }
 */
export class AddMCPSupportToPluginInstances1765295751000 implements MigrationInterface {
  name = "AddMCPSupportToPluginInstances1765295751000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add comment to document the new mcpServers field in config JSONB
    await queryRunner.query(`
      COMMENT ON COLUMN plugin_instances.config IS
      'Plugin instance configuration (JSONB). Can include plugin-specific settings and mcpServers configuration for MCP support.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert comment to original
    await queryRunner.query(`
      COMMENT ON COLUMN plugin_instances.config IS
      'Plugin instance configuration (JSONB). Can include plugin-specific settings.'
    `);
  }
}
