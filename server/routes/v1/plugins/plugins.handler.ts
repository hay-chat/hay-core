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

interface PluginHealthCheckResult {
  success: boolean;
  status: "healthy" | "unhealthy" | "unconfigured";
  message?: string;
  error?: string;
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
      return !manifest.invisible;
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

    return {
      configuration: maskedConfig,
      enabled: instance.enabled,
      instanceId: instance.id,
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
 */
export const getMCPTools = authenticatedProcedure.query(async ({ ctx }) => {
  // Get all enabled plugin instances for this organization
  const instances = await pluginInstanceRepository.findByOrganization(ctx.organizationId!);
  const enabledInstances = instances.filter((i) => i.enabled);

  // Get all plugins and filter to only enabled ones
  const allPlugins = pluginManagerService.getAllPlugins();
  const enabledPluginIds = new Set(enabledInstances.map((i) => i.pluginId));

  const mcpTools: Array<{
    id: string;
    name: string;
    label: string;
    description: string;
    pluginId: string;
    pluginName: string;
  }> = [];

  // Process each enabled plugin
  for (const plugin of allPlugins) {
    // Check if this plugin is enabled for the organization
    if (!enabledPluginIds.has(plugin.id)) {
      continue;
    }

    const manifest = plugin.manifest as HayPluginManifest;

    // Check if plugin has MCP capabilities with tools
    if (!manifest.capabilities?.mcp?.tools) {
      continue;
    }

    // Extract tools from this plugin
    for (const tool of manifest.capabilities.mcp.tools) {
      mcpTools.push({
        id: `${plugin.pluginId}:${tool.name}`,
        name: tool.name,
        label: tool.label || tool.name,
        description: tool.description || "",
        pluginId: plugin.pluginId,
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

    // Check if plugin has MCP capabilities
    if (!manifest.capabilities?.mcp) {
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
      // Get available MCP tools from manifest
      const mcpTools = manifest.capabilities.mcp.tools || [];

      // Determine which tool to use for health check (priority order)
      let testTool: string | null = null;
      let testArgs: Record<string, unknown> = {};

      // Priority 1: Look for health check tools
      const healthCheckTools = mcpTools.filter(
        (tool) =>
          tool.name.toLowerCase().includes("health") || tool.name.toLowerCase().includes("check"),
      );
      if (healthCheckTools.length > 0) {
        testTool = healthCheckTools[0].name;
      }

      // Priority 2: Look for info/support tools
      if (!testTool) {
        const infoTools = mcpTools.filter(
          (tool) =>
            tool.name.toLowerCase().includes("info") || tool.name.toLowerCase().includes("support"),
        );
        if (infoTools.length > 0) {
          testTool = infoTools[0].name;
        }
      }

      // Priority 3: Look for list tools (with minimal parameters)
      if (!testTool) {
        const listTools = mcpTools.filter(
          (tool) =>
            tool.name.toLowerCase().startsWith("list") || tool.name.toLowerCase().startsWith("get"),
        );
        if (listTools.length > 0) {
          testTool = listTools[0].name;
          // Use minimal parameters for list tools
          testArgs = { limit: 1 };
        }
      }

      // Priority 4: Use initialize if no tools found
      if (!testTool) {
        testTool = "initialize";
        testArgs = {};
      }

      // Prepare MCP request
      const mcpRequest = {
        jsonrpc: "2.0",
        id: uuidv4(),
        method: testTool === "initialize" ? "initialize" : "tools/call",
        params:
          testTool === "initialize"
            ? {}
            : {
                name: testTool,
                arguments: testArgs,
              },
      };

      // Check connection type and use appropriate method
      const connectionType = manifest.capabilities.mcp.connection?.type || "local";
      let mcpResponse: any;

      if (connectionType === "remote") {
        // Use MCP client factory for remote plugins
        const client = await MCPClientFactory.createClient(ctx.organizationId!, input.pluginId);

        try {
          // First, list available tools to see what the server actually provides
          const availableTools = await client.listTools();

          if (testTool === "initialize") {
            // For initialize, just check if we can connect and list tools
            mcpResponse = {
              result: {
                capabilities: {
                  tools: availableTools.length > 0,
                },
              },
            };
          } else {
            // Check if the test tool exists in available tools
            const toolExists = availableTools.some((t) => t.name === testTool);

            if (!toolExists && availableTools.length > 0) {
              // Use the first available tool instead
              testTool = availableTools[0].name;
              testArgs = {};
            }

            // Call the actual tool
            const toolResult = await client.callTool(testTool, testArgs);
            mcpResponse = {
              result: toolResult,
            };
          }
        } finally {
          await client.close();
        }
      } else {
        // Use process manager for local plugins
        const result = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Connection timeout - verify server is accessible"));
          }, 10000); // 10 second timeout for health checks

          processManagerService
            .sendToPlugin(ctx.organizationId!, input.pluginId, "mcp_call", mcpRequest)
            .then((response) => {
              clearTimeout(timeout);
              resolve(response);
            })
            .catch((error) => {
              clearTimeout(timeout);
              reject(error);
            });
        });
        mcpResponse = result as any;
      }

      // Check if the response contains an error
      if (mcpResponse && typeof mcpResponse === "object") {
        // Check for JSON-RPC error response
        if (mcpResponse.error) {
          return {
            success: false,
            status: "unhealthy",
            message: mcpResponse.error.message || "MCP server returned an error",
            error:
              mcpResponse.error.message || JSON.stringify(mcpResponse.error) || "Unknown MCP error",
            testedAt: new Date(),
          };
        }

        // Check for result with isError flag
        if (mcpResponse.result && mcpResponse.result.isError) {
          const errorText = mcpResponse.result.content?.[0]?.text || "Unknown MCP error";

          // Check if it's an authentication error
          const isAuthError =
            errorText.includes("401") ||
            errorText.includes("Couldn't authenticate") ||
            errorText.includes("Authentication failed") ||
            errorText.includes("Unauthorized");

          return {
            success: false,
            status: isAuthError ? "unconfigured" : "unhealthy",
            message: isAuthError
              ? "Authentication failed - check credentials"
              : "MCP server returned an error",
            error: errorText,
            testedAt: new Date(),
          };
        }

        // Check for authentication errors in the content (for responses without isError flag)
        if (mcpResponse.result && mcpResponse.result.content) {
          const content = mcpResponse.result.content;
          if (Array.isArray(content)) {
            for (const item of content) {
              if (item.type === "text" && item.text) {
                // Check for common authentication error patterns
                if (
                  item.text.includes("401") ||
                  item.text.includes("Couldn't authenticate") ||
                  item.text.includes("Authentication failed") ||
                  item.text.includes("Unauthorized")
                ) {
                  return {
                    success: false,
                    status: "unconfigured",
                    message: "Authentication failed - check credentials",
                    error: item.text,
                    testedAt: new Date(),
                  };
                }
              }
            }
          }
        }
      }

      return {
        success: true,
        status: "healthy",
        message: `Connection successful using ${testTool}`,
        testedAt: new Date(),
      };
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
