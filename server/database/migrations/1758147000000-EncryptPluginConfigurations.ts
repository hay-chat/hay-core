import { MigrationInterface, QueryRunner } from "typeorm";
import { encryptConfig, decryptConfig } from "../../lib/auth/utils/encryption";

export class EncryptPluginConfigurations1758147000000 implements MigrationInterface {
  name = "EncryptPluginConfigurations1758147000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Get all plugin instances with their configurations
    const instances = await queryRunner.query(`
      SELECT
        pi.id,
        pi.config,
        pr.manifest
      FROM plugin_instances pi
      INNER JOIN plugin_registry pr ON pi.plugin_id = pr.id
      WHERE pi.config IS NOT NULL
    `);

    for (const instance of instances) {
      if (!instance.config || Object.keys(instance.config).length === 0) {
        continue;
      }

      const manifest = instance.manifest as any;
      const configSchema = manifest?.configSchema || {};

      // Check if config is already encrypted
      let needsEncryption = false;
      for (const [key, value] of Object.entries(instance.config)) {
        if (configSchema[key]?.encrypted && value !== null && value !== undefined) {
          // Check if it's already in encrypted format
          if (
            !(value && typeof value === "object" && (value as Record<string, unknown>).encrypted)
          ) {
            needsEncryption = true;
            break;
          }
        }
      }

      if (needsEncryption) {
        // Encrypt the configuration
        const encryptedConfig = encryptConfig(instance.config, configSchema as any);

        // Update the database
        await queryRunner.query(`UPDATE plugin_instances SET config = $1 WHERE id = $2`, [
          JSON.stringify(encryptedConfig),
          instance.id,
        ]);

        console.log(`✅ Encrypted configuration for plugin instance ${instance.id}`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Get all plugin instances with encrypted configurations
    const instances = await queryRunner.query(`
      SELECT
        pi.id,
        pi.config
      FROM plugin_instances pi
      WHERE pi.config IS NOT NULL
    `);

    for (const instance of instances) {
      if (!instance.config || Object.keys(instance.config).length === 0) {
        continue;
      }

      // Check if config is encrypted
      let isEncrypted = false;
      for (const [_key, value] of Object.entries(instance.config)) {
        if (value && typeof value === "object" && (value as Record<string, unknown>).encrypted) {
          isEncrypted = true;
          break;
        }
      }

      if (isEncrypted) {
        try {
          // Decrypt the configuration
          const decryptedConfig = decryptConfig(instance.config);

          // Update the database
          await queryRunner.query(`UPDATE plugin_instances SET config = $1 WHERE id = $2`, [
            JSON.stringify(decryptedConfig),
            instance.id,
          ]);

          console.log(`✅ Decrypted configuration for plugin instance ${instance.id}`);
        } catch (error) {
          console.error(`Failed to decrypt config for instance ${instance.id}:`, error);
        }
      }
    }
  }
}
