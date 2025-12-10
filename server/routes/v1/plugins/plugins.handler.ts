import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authenticatedProcedure } from "@server/trpc";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { pluginUIService } from "@server/services/plugin-ui.service";
import { processManagerService } from "@server/services/process-manager.service";
import { decryptConfig, isEncrypted } from "@server/lib/auth/utils/encryption";
import { oauthService } from "@server/services/oauth.service";
import { v4 as uuidv4 } from "uuid";
import type { HayPluginManifest } from "@server/types/plugin.types";
import { MCPClientFactory } from "@server/services/mcp-client-factory.service";
import { PluginStatus } from "@server/entities/plugin-registry.entity";

interface PluginHealthCheckResult {
  success: boolean;
  status: "healthy" | "unhealthy" | "unconfigured";
  message?: string;
  error?: string;
  tools?: Array<{ name: string; description: string }>;
  testedAt: Date;
}

/**
 * Get all available plugins (core + organization's custom plugins)
 */
export const getAllPlugins = authenticatedProcedure.query(async ({ ctx }) => {
  // Get plugins visible to this organization (core + org's custom)
  const plugins = await pluginRegistryRepository.findByOrganization(ctx.organizationId!);

  // Get enabled instances for this organization
  const instances = await pluginInstanceRepository.findByOrganization(ctx.organizationId!);
  const enabledPluginIds = new Set(instances.filter((i) => i.enabled).map((i) => i.pluginId));

  return plugins
    .filter((plugin) => {
      const manifest = plugin.manifest as HayPluginManifest;
      // Filter out invisible plugins from the marketplace listing
      if (manifest.invisible) return false;

      // Filter out plugins marked as not_found (source files removed)
      if (plugin.status === PluginStatus.NOT_FOUND) return false;

      return true;
    })
    .map((plugin) => {
      const manifest = plugin.manifest as HayPluginManifest;
      const result = {
        id: plugin.pluginId, // Use pluginId as the identifier for frontend
        dbId: plugin.id, // Keep database ID for reference
        name: plugin.name,
        version: plugin.version,
        type: manifest.type,
        description: manifest.configSchema
          ? Object.values(manifest.configSchema)[0]?.description
          : `${plugin.name} plugin`,
        installed: plugin.installed,
        built: plugin.built,
        enabled: enabledPluginIds.has(plugin.id),
        hasConfiguration: !!manifest.configSchema,
        hasCustomUI: !!manifest.ui?.configuration,
        capabilities: manifest.capabilities,
        features: manifest.capabilities?.chat_connector?.features || {},
        sourceType: plugin.sourceType,
        isCustom: plugin.sourceType === "custom",
        uploadedAt: plugin.uploadedAt,
        uploadedBy: plugin.uploadedBy,
        status: plugin.status || PluginStatus.AVAILABLE, // Include status field
      };

      return result;
    });
});

/**
 * Get a specific plugin by ID
 */
export const getPlugin = authenticatedProcedure
  .input(
    z.object({
      pluginId: z.string(),
    }),
  )
  .query(async ({ input }) => {
    const plugin = pluginManagerService.getPlugin(input.pluginId);

    if (!plugin) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Plugin ${input.pluginId} not found`,
      });
    }

    // Check if plugin source files are missing
    if (plugin.status === PluginStatus.NOT_FOUND) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Plugin ${input.pluginId} source files not found. The plugin may have been removed.`,
      });
    }

    const manifest = plugin.manifest as HayPluginManifest;
    return {
      id: plugin.pluginId, // Use pluginId as the identifier
      dbId: plugin.id, // Keep database ID for reference
      name: plugin.name,
      version: plugin.version,
      type: manifest.type,
      manifest: manifest,
      installed: plugin.installed,
      built: plugin.built,
      status: plugin.status || PluginStatus.AVAILABLE,
    };
  });

/**
 * Get plugin instances for the organization
 */
export const getPluginInstances = authenticatedProcedure.query(async ({ ctx }) => {
  return await pluginInstanceRepository.findByOrganization(ctx.organizationId!);
});

/**
 * Enable a plugin for the organization
 */
export const enablePlugin = authenticatedProcedure
  .input(
    z.object({
      pluginId: z.string(),
      configuration: z.record(z.any()).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const plugin = pluginManagerService.getPlugin(input.pluginId);

    if (!plugin) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Plugin ${input.pluginId} not found`,
      });
    }

    // Validate organization access for custom plugins
    if (plugin.sourceType === "custom" && plugin.organizationId !== ctx.organizationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Cannot enable plugins from other organizations",
      });
    }

    try {
      // Check if plugin needs installation
      if (pluginManagerService.needsInstallation(input.pluginId)) {
        console.log(`🚀 [HAY] Starting installation for ${plugin.name}...`);
        await pluginManagerService.installPlugin(input.pluginId);
      }

      // Check if plugin needs building
      if (pluginManagerService.needsBuilding(input.pluginId)) {
        console.log(`🚀 [HAY] Starting build for ${plugin.name}...`);
        await pluginManagerService.buildPlugin(input.pluginId);
      }

      // Only enable plugin if installation and build succeeded
      console.log(`🚀 [HAY] Enabling ${plugin.name} for organization...`);
      const instance = await pluginInstanceRepository.enablePlugin(
        ctx.organizationId!,
        input.pluginId,
        input.configuration || {},
      );

      console.log(`✅ [HAY OK] Plugin ${plugin.name} successfully enabled`);

      // For MCP plugins, start the worker immediately so it can register its MCP servers
      const manifest = plugin.manifest as any;
      const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];

      if (capabilities.includes('mcp')) {
        console.log(`🚀 [HAY] Starting worker for MCP plugin ${plugin.name}...`);
        try {
          await pluginManagerService.getOrStartWorker(ctx.organizationId!, input.pluginId);
          console.log(`✅ [HAY OK] Worker started for ${plugin.name}`);
        } catch (workerError) {
          console.error(`⚠️ [HAY WARNING] Failed to start worker for ${plugin.name}:`, workerError);
          // Don't fail the entire enable operation if worker fails to start
          // The worker can be started later on-demand
        }
      }

      return {
        success: true,
        instance,
      };
    } catch (error) {
      console.error(`❌ [HAY FAILED] Failed to enable plugin ${plugin.name}:`, error);

      // Extract the most relevant error message
      let errorMessage = "Unknown error";
      if (error instanceof Error) {
        // Clean up the error message for the user
        errorMessage = error.message
          .replace(/Failed to \w+ plugin hay-plugin-\w+: /, "") // Remove redundant prefix
          .replace(/Error: /, "") // Remove Error: prefix
          .replace(/Command failed: /, "Command failed: "); // Keep command failed for clarity
      }

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to enable ${plugin.name}: ${errorMessage}`,
      });
    }
  });

/**
 * Disable a plugin for the organization
 */
export const disablePlugin = authenticatedProcedure
  .input(
    z.object({
      pluginId: z.string(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const plugin = pluginManagerService.getPlugin(input.pluginId);
    if (!plugin) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Plugin ${input.pluginId} not found`,
      });
    }

    await pluginInstanceRepository.disablePlugin(ctx.organizationId!, input.pluginId);

    return {
      success: true,
    };
  });

/**
 * Configure a plugin
 */
export const configurePlugin = authenticatedProcedure
  .input(
    z.object({
      pluginId: z.string(),
      configuration: z.record(z.any()),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const plugin = pluginManagerService.getPlugin(input.pluginId);
    if (!plugin) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Plugin ${input.pluginId} not found`,
      });
    }

    const manifest = plugin.manifest as HayPluginManifest;
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      ctx.organizationId!,
      input.pluginId,
    );

    // When updating configuration, we need to handle partial updates properly
    let finalConfig = input.configuration;

    if (instance && instance.config) {
      // Get existing decrypted config
      const existingDecrypted = decryptConfig(instance.config);

      // Merge with new config, preserving non-updated encrypted fields
      for (const [key, value] of Object.entries(input.configuration)) {
        // If the value is masked (all asterisks), keep the existing value
        if (typeof value === "string" && /^\*+$/.test(value)) {
          finalConfig[key] = existingDecrypted[key];
        }
      }

      // Also preserve any fields not included in the update
      for (const [key, value] of Object.entries(existingDecrypted)) {
        if (!(key in finalConfig)) {
          finalConfig[key] = value;
        }
      }
    }

    if (!instance) {
      // Create new instance if it doesn't exist
      const newInstance = await pluginInstanceRepository.enablePlugin(
        ctx.organizationId!,
        input.pluginId,
        finalConfig,
      );

      return {
        success: true,
        instance: newInstance,
      };
    }

    await pluginInstanceRepository.updateConfig(instance.id, finalConfig);

    // Restart the plugin if it's currently running to apply new configuration
    if (processManagerService.isRunning(ctx.organizationId!, input.pluginId)) {
      console.log(
        `🔄 Configuration changed for ${plugin.name}, restarting plugin to apply new settings...`,
      );
      try {
        await processManagerService.restartPlugin(ctx.organizationId!, input.pluginId);
        console.log(`✅ Plugin ${plugin.name} restarted with new configuration`);
      } catch (error) {
        console.error(
          `⚠️  Failed to restart ${plugin.name} after config change:`,
          error instanceof Error ? error.message : String(error),
        );
        // Don't throw - config was saved successfully, restart failure is non-critical
      }
    }

    return {
      success: true,
      instance: { ...instance, config: finalConfig },
    };
  });

/**
 * Get plugin configuration
 */
export const getPluginConfiguration = authenticatedProcedure
  .input(
    z.object({
      pluginId: z.string(),
    }),
  )
  .query(async ({ ctx, input }) => {
    const plugin = pluginManagerService.getPlugin(input.pluginId);
    if (!plugin) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Plugin ${input.pluginId} not found`,
      });
    }

    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      ctx.organizationId!,
      input.pluginId,
    );

    const manifest = plugin.manifest as HayPluginManifest;

    if (!instance) {
      // Return default configuration from manifest
      const defaultConfig: Record<string, any> = {};

      if (manifest.configSchema) {
        Object.entries(manifest.configSchema).forEach(([key, field]) => {
          if (field.default !== undefined) {
            defaultConfig[key] = field.default;
          }
        });
      }

      return {
        configuration: defaultConfig,
        enabled: false,
        instanceId: null,
      };
    }

    // Decrypt the configuration but mask sensitive values for the UI
    const decryptedConfig = instance.config ? decryptConfig(instance.config) : {};
    const maskedConfig: Record<string, any> = {};

    // Mask sensitive values for display
    for (const [key, value] of Object.entries(decryptedConfig)) {
      const schema = manifest.configSchema?.[key];
      if (schema?.encrypted && value) {
        // For encrypted fields, only show masked value
        maskedConfig[key] = "*".repeat(8);
      } else {
        maskedConfig[key] = value;
      }
    }

    // Extract auth config from MCP servers if present
    let authConfig = undefined;
    if (decryptedConfig.mcpServers && typeof decryptedConfig.mcpServers === 'object' && decryptedConfig.mcpServers !== null) {
      const mcpServers = decryptedConfig.mcpServers as any;
      if (mcpServers.remote && Array.isArray(mcpServers.remote) && mcpServers.remote.length > 0) {
        const remoteMcp = mcpServers.remote[0];
        if (remoteMcp.auth?.type === "oauth2") {
          authConfig = remoteMcp.auth;
        }
      }
    }

    return {
      configuration: maskedConfig,
      enabled: instance.enabled,
      instanceId: instance.id,
      auth: authConfig, // Include auth config from MCP servers
    };
  });

/**
 * Get UI template for plugin configuration
 */
export const getPluginUITemplate = authenticatedProcedure
  .input(
    z.object({
      pluginId: z.string(),
    }),
  )
  .query(async ({ input }) => {
    const template = await pluginUIService.getConfigurationTemplate(input.pluginId);

    if (!template) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `No UI template found for plugin ${input.pluginId}`,
      });
    }

    return {
      template,
      type: "vue",
    };
  });

/**
 * Get all available MCP tools from enabled plugins
 * Tools are now registered dynamically by plugins at runtime
 */
export const getMCPTools = authenticatedProcedure.query(async ({ ctx }) => {
  // Get all enabled plugin instances for this organization
  const instances = await pluginInstanceRepository.findByOrganization(ctx.organizationId!);
  const enabledInstances = instances.filter((i) => i.enabled);

  // Get all plugins
  const allPlugins = pluginManagerService.getAllPlugins();
  const pluginMap = new Map(allPlugins.map(p => [p.id, p]));

  const mcpTools: Array<{
    id: string;
    name: string;
    label: string;
    description: string;
    pluginId: string;
    pluginName: string;
  }> = [];

  // Process each enabled plugin instance
  for (const instance of enabledInstances) {
    const plugin = pluginMap.get(instance.pluginId);
    if (!plugin) {
      continue;
    }

    const manifest = plugin.manifest as HayPluginManifest;

    // Check if plugin has MCP capability
    const capabilities = Array.isArray(manifest.capabilities)
      ? manifest.capabilities
      : [];

    if (!capabilities.includes("mcp")) {
      continue;
    }

    // Get tools from instance config (registered dynamically at runtime)
    const config = instance.config as any;
    let tools: any[] = [];

    // Check local MCP servers
    if (config?.mcpServers?.local && Array.isArray(config.mcpServers.local)) {
      for (const server of config.mcpServers.local) {
        if (server.tools && Array.isArray(server.tools)) {
          tools = tools.concat(server.tools);
        }
      }
    }

    // Check remote MCP servers
    if (config?.mcpServers?.remote && Array.isArray(config.mcpServers.remote)) {
      for (const server of config.mcpServers.remote) {
        if (server.tools && Array.isArray(server.tools)) {
          tools = tools.concat(server.tools);
        }
      }
    }

    // Add tools to result
    for (const tool of tools) {
      mcpTools.push({
        id: `${plugin.id}:${tool.name}`,
        name: tool.name,
        label: tool.name,
        description: tool.description || "",
        pluginId: plugin.id,
        pluginName: plugin.name,
      });
    }
  }

  return mcpTools;
});

/**
 * Get menu items from all plugins (system and organization-specific)
 */
export const getMenuItems = authenticatedProcedure.query(async ({ ctx }) => {
  const allPlugins = pluginManagerService.getAllPlugins();
  const menuItems: Array<{
    id: string;
    title: string;
    url: string;
    icon?: string;
    parent?: "settings" | "integrations" | "root";
    position?: number;
    pluginId: string;
  }> = [];

  // Get enabled instances for organization-specific plugins
  const instances = await pluginInstanceRepository.findByOrganization(ctx.organizationId!);
  const enabledPluginIds = new Set(instances.filter((i) => i.enabled).map((i) => i.pluginId));

  for (const plugin of allPlugins) {
    const manifest = plugin.manifest as HayPluginManifest;

    // Check if this is a system plugin (autoActivate) or an enabled organization plugin
    const isSystemPlugin = manifest.autoActivate === true;
    const isEnabledOrgPlugin = enabledPluginIds.has(plugin.id);

    if (!isSystemPlugin && !isEnabledOrgPlugin) {
      continue;
    }

    // Extract menu items from this plugin
    if (manifest.menuItems) {
      for (const item of manifest.menuItems) {
        menuItems.push({
          ...item,
          pluginId: plugin.pluginId,
        });
      }
    }
  }

  // Sort by position if provided
  menuItems.sort((a, b) => (a.position || 999) - (b.position || 999));

  return {
    items: menuItems,
  };
});

/**
 * Test MCP connection for a plugin
 */
export const testConnection = authenticatedProcedure
  .input(
    z.object({
      pluginId: z.string(),
    }),
  )
  .query(async ({ ctx, input }): Promise<PluginHealthCheckResult> => {
    const plugin = pluginManagerService.getPlugin(input.pluginId);

    if (!plugin) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Plugin ${input.pluginId} not found`,
      });
    }

    const manifest = plugin.manifest as HayPluginManifest;

    // Check if plugin has MCP capabilities (support both TypeScript-first array and legacy object format)
    const hasMcpCapability = Array.isArray(manifest.capabilities)
      ? manifest.capabilities.includes('mcp')
      : !!manifest.capabilities?.mcp;

    if (!hasMcpCapability) {
      return {
        success: false,
        status: "unhealthy",
        message: "Plugin does not support MCP connections",
        testedAt: new Date(),
      };
    }

    // Check if plugin instance exists and has configuration
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      ctx.organizationId!,
      input.pluginId,
    );

    if (!instance || !instance.config) {
      return {
        success: false,
        status: "unconfigured",
        message: "Plugin configuration is missing",
        testedAt: new Date(),
      };
    }

    try {
      // Get MCP tools from database (all plugins now register tools dynamically)
      let mcpTools: any[] = [];
      const config = instance.config as any;

      // Check local MCP servers
      if (config?.mcpServers?.local && config.mcpServers.local.length > 0) {
        for (const server of config.mcpServers.local) {
          if (server.tools && Array.isArray(server.tools)) {
            mcpTools = mcpTools.concat(server.tools);
          }
        }
      }

      // Check remote MCP servers (e.g., HubSpot, Stripe)
      if (config?.mcpServers?.remote && config.mcpServers.remote.length > 0) {
        for (const server of config.mcpServers.remote) {
          if (server.tools && Array.isArray(server.tools)) {
            mcpTools = mcpTools.concat(server.tools);
          }
        }
      }

      // All plugins now use TypeScript-first: verify tools are registered
      // The plugin worker has already validated connectivity by registering successfully
      if (mcpTools.length > 0) {
        return {
          success: true,
          status: "healthy",
          message: `Plugin is running with ${mcpTools.length} MCP tools registered`,
          tools: mcpTools.map(t => ({
            name: t.name,
            description: t.description,
          })),
          testedAt: new Date(),
        };
      } else {
        return {
          success: false,
          status: "unhealthy",
          message: "No MCP tools registered yet - plugin may still be initializing",
          testedAt: new Date(),
        };
      }
    } catch (error) {
      let errorMessage = "Unknown error";
      let status: "unhealthy" | "unconfigured" = "unhealthy";

      if (error instanceof Error) {
        errorMessage = error.message;

        // Categorize error types
        if (errorMessage.includes("timeout") || errorMessage.includes("Connection timeout")) {
          errorMessage = "Connection timeout - verify server is accessible";
        } else if (
          errorMessage.includes("Authentication") ||
          errorMessage.includes("401") ||
          errorMessage.includes("403")
        ) {
          errorMessage = "Authentication failed - check credentials";
          status = "unconfigured";
        } else if (
          errorMessage.includes("Failed to start") ||
          errorMessage.includes("Process not available")
        ) {
          errorMessage = "Failed to start MCP server - check configuration";
        }
      }

      return {
        success: false,
        status,
        message: errorMessage,
        error: errorMessage,
        testedAt: new Date(),
      };
    }
  });

/**
 * Initiate OAuth authorization flow
 */
export const initiateOAuth = authenticatedProcedure
  .input(
    z.object({
      pluginId: z.string(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const { authorizationUrl, state } = await oauthService.initiateOAuth(
      input.pluginId,
      ctx.organizationId!,
      ctx.user!.id,
    );

    return {
      authorizationUrl,
      state,
    };
  });

/**
 * Check if OAuth is available for a plugin
 */
export const isOAuthAvailable = authenticatedProcedure
  .input(
    z.object({
      pluginId: z.string(),
    }),
  )
  .query(async ({ input }) => {
    const plugin = pluginManagerService.getPlugin(input.pluginId);
    if (!plugin) {
      return { available: false };
    }

    const manifest = plugin.manifest as HayPluginManifest;
    const available = oauthService.isOAuthAvailable(input.pluginId, manifest);

    return { available };
  });

/**
 * Get OAuth connection status
 */
export const getOAuthStatus = authenticatedProcedure
  .input(
    z.object({
      pluginId: z.string(),
    }),
  )
  .query(async ({ ctx, input }) => {
    return await oauthService.getConnectionStatus(ctx.organizationId!, input.pluginId);
  });

/**
 * Revoke OAuth connection
 */
export const revokeOAuth = authenticatedProcedure
  .input(
    z.object({
      pluginId: z.string(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    await oauthService.revokeOAuth(ctx.organizationId!, input.pluginId);
    return { success: true };
  });
