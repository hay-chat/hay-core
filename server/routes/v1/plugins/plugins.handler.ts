import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authenticatedProcedure } from "@server/trpc";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { pluginUIService } from "@server/services/plugin-ui.service";
import { processManagerService } from "@server/services/process-manager.service";
import { getPluginRunnerV2Service } from "@server/services/plugin-runner-v2.service";
import { decryptConfig, isEncrypted } from "@server/lib/auth/utils/encryption";
import { resolveConfigWithEnv } from "@server/lib/config-resolver";
import { oauthService } from "@server/services/oauth.service";
import { v4 as uuidv4 } from "uuid";
import type { HayPluginManifest } from "@server/types/plugin.types";
import type { AuthMethodDescriptor, ConfigFieldDescriptor } from "@server/types/plugin-sdk-v2.types";
import type { PluginConfigWithOAuth } from "@server/types/oauth.types";
import { MCPClientFactory } from "@server/services/mcp-client-factory.service";
import { PluginStatus } from "@server/entities/plugin-registry.entity";
import { separateConfigAndAuth, hasAuthChanges, extractAuthState } from "@server/lib/plugin-utils";
import { fetchToolsFromWorker, fetchAndStoreTools } from "@server/services/plugin-tools.service";
import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { existsSync } from "fs";

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

      // Use metadata for SDK v2 runtime config
      const configSchema = plugin.metadata?.configSchema || {};
      // Capabilities remain in manifest for both SDK v1 and v2
      const capabilities = manifest.capabilities;

      const result = {
        id: plugin.pluginId, // Use pluginId as the identifier for frontend
        dbId: plugin.id, // Keep database ID for reference
        name: plugin.name,
        version: plugin.version,
        type: manifest.type,
        description: configSchema
          ? Object.values(configSchema)[0]?.description
          : `${plugin.name} plugin`,
        installed: plugin.installed,
        built: plugin.built,
        enabled: enabledPluginIds.has(plugin.id),
        configSchema, // Runtime config schema from metadata
        hasConfiguration: Object.keys(configSchema).length > 0,
        hasCustomUI: !!manifest.ui?.configuration,
        capabilities, // Use metadata capabilities for SDK v2
        features: manifest.capabilities?.chat_connector?.features || {},
        sourceType: plugin.sourceType,
        isCustom: plugin.sourceType === "custom",
        uploadedAt: plugin.uploadedAt,
        uploadedBy: plugin.uploadedBy,
        status: plugin.status || PluginStatus.AVAILABLE, // Include status field
        metadata: plugin.metadata, // Include full metadata for SDK v2
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
  .query(async ({ ctx, input }) => {
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

    // Get plugin instance for this organization
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      ctx.organizationId!,
      input.pluginId,
    );

    // For SDK v2 plugins, use cached metadata first, then try worker if needed
    let configSchema = manifest.configSchema;

    // Return cached metadata for SDK v2 plugins even when not enabled
    if (plugin.metadata?.configSchema) {
      configSchema = plugin.metadata.configSchema;
    }

    // For enabled plugins, try fetching fresh metadata from worker
    if (instance && instance.enabled) {
      try {
        const runnerV2 = getPluginRunnerV2Service();
        const worker = runnerV2.getWorker(ctx.organizationId!, input.pluginId);
        if (worker && worker.port) {
          const metadataResponse = await fetch(`http://localhost:${worker.port}/metadata`);
          if (metadataResponse.ok) {
            const metadata = await metadataResponse.json();
            if (metadata.configSchema) {
              configSchema = metadata.configSchema;
            }
            // Update database metadata
            await pluginRegistryRepository.updateMetadata(input.pluginId, {
              ...metadata,
              updatedAt: new Date(),
            });

            // Update in-memory registry
            const updatedPlugin = pluginManagerService.getPlugin(input.pluginId);
            if (updatedPlugin) {
              updatedPlugin.metadata = metadata;
            }
          }
        } else {
          // Worker not running, try to start it
          const newWorker = await runnerV2.startWorker(ctx.organizationId!, input.pluginId);
          if (newWorker && newWorker.port) {
            const metadataResponse2 = await fetch(`http://localhost:${newWorker.port}/metadata`);
            if (metadataResponse2.ok) {
              const metadata2 = await metadataResponse2.json();
              if (metadata2.configSchema) {
                configSchema = metadata2.configSchema;
              }
              // Update database metadata
              await pluginRegistryRepository.updateMetadata(input.pluginId, {
                ...metadata2,
                updatedAt: new Date(),
              });

              // Update in-memory registry
              const updatedPlugin2 = pluginManagerService.getPlugin(input.pluginId);
              if (updatedPlugin2) {
                updatedPlugin2.metadata = metadata2;
              }
            }
          }
        }
      } catch (error) {
        console.warn(
          `[getPlugin] Failed to fetch metadata from SDK v2 worker for ${input.pluginId}:`,
          error,
        );
      }
    }

    // Build configuration data
    let configuration: Record<string, any> = {};
    let configMetadata: Record<string, any> = {};
    let oauthAvailable = false;
    let oauthConfigured = false;
    let oauthConnected = false;

    if (!instance) {
      // Return default configuration from manifest or worker metadata
      if (configSchema) {
        Object.entries(configSchema).forEach(([key, field]) => {
          if (field.default !== undefined) {
            configuration[key] = field.default;
          }
        });
      }
    } else {
      // Use config resolver to get values with .env fallback and metadata
      const resolved = configSchema
        ? resolveConfigWithEnv(instance.config, configSchema as Record<string, ConfigFieldDescriptor>, {
            decrypt: true,
            maskSecrets: true,
          })
        : { values: {}, metadata: {} };

      configuration = { ...resolved.values };
      configMetadata = resolved.metadata;

      // Add auth credentials (encrypted fields) and mask them
      if (instance.authState?.credentials) {
        for (const [key, value] of Object.entries(instance.authState.credentials)) {
          if (value !== null && value !== undefined) {
            configuration[key] = "*".repeat(8);
          }
        }
      }

      // Check OAuth status
      if (plugin.metadata?.authMethods) {
        const oauth2Method = plugin.metadata.authMethods.find(
          (method: AuthMethodDescriptor) => method.type === "oauth2",
        );
        if (oauth2Method) {
          oauthAvailable = true;

          const clientIdFieldName = oauth2Method.clientId;
          const clientSecretFieldName = oauth2Method.clientSecret;

          if (clientIdFieldName && clientSecretFieldName) {
            const hasClientId = !!(
              resolved.metadata[clientIdFieldName]?.value ||
              instance.authState?.credentials?.[clientIdFieldName]
            );
            const hasClientSecret = !!(
              resolved.metadata[clientSecretFieldName]?.value ||
              instance.authState?.credentials?.[clientSecretFieldName]
            );

            oauthConfigured = hasClientId && hasClientSecret;
          }

          const configWithOAuth = instance.config ? (decryptConfig(instance.config) as PluginConfigWithOAuth) : {};
          if (configWithOAuth._oauth?.tokens?.access_token) {
            oauthConnected = true;
          }
        }
      }
    }

    return {
      // Plugin metadata
      id: plugin.pluginId,
      dbId: plugin.id,
      name: plugin.name,
      version: plugin.version,
      type: manifest.type,
      pluginPath: plugin.pluginPath,
      manifest,
      metadata: plugin.metadata,
      installed: plugin.installed,
      built: plugin.built,
      status: plugin.status || PluginStatus.AVAILABLE,

      // Configuration data (from getPluginConfiguration)
      configuration,
      configMetadata,
      enabled: instance ? instance.enabled : false,
      instanceId: instance ? instance.id : null,
      oauthAvailable,
      oauthConfigured,
      oauthConnected,
      auth: instance ? instance.authState : undefined,
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

      if (capabilities.includes("mcp")) {
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

    // SDK v2: Call plugin's disable hook (if worker running)
    const worker = pluginManagerService.getWorker(ctx.organizationId!, input.pluginId);
    if (worker && worker.sdkVersion === "v2") {
      try {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 5000);

        await fetch(`http://localhost:${worker.port}/disable`, {
          method: "POST",
          signal: abortController.signal,
        });

        clearTimeout(timeoutId);
        console.log(`✅ Called /disable hook for ${plugin.name}`);
      } catch (error) {
        console.warn(`⚠️ Plugin disable hook failed for ${plugin.name}:`, error);
        // Continue anyway - cleanup failure should not block disable
      }
    }

    // Stop worker (handles both SDK v1 and v2)
    await pluginManagerService.stopPluginWorker(ctx.organizationId!, input.pluginId);

    // Disable in database
    await pluginInstanceRepository.disablePlugin(ctx.organizationId!, input.pluginId);

    return {
      success: true,
    };
  });

/**
 * Configure a plugin (SDK v2 with auth separation)
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

    // Get plugin registry to access SDK v2 metadata (if available)
    const pluginRegistry = await pluginRegistryRepository.findByPluginId(input.pluginId);
    const metadata = pluginRegistry?.metadata; // SDK v2 metadata from /metadata endpoint

    // When updating configuration, we need to handle partial updates properly
    let finalConfig = input.configuration;
    const configSchema = metadata?.configSchema || manifest.configSchema;

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
      // BUT: don't preserve fields that have env fallbacks (allow reset to env)
      for (const [key, value] of Object.entries(existingDecrypted)) {
        if (!(key in finalConfig)) {
          // Check if field has env fallback
          const fieldSchema = configSchema?.[key];
          const hasEnvFallback = fieldSchema?.env && process.env[fieldSchema.env];

          // Only preserve if no env fallback (can't reset to env)
          if (!hasEnvFallback) {
            finalConfig[key] = value;
          }
          // Otherwise, omit it to allow falling back to env
        }
      }
    }

    // SDK v2: Separate config and auth
    const { config, authState } = separateConfigAndAuth(finalConfig, metadata);

    // Validate required fields are satisfied by either DB config or .env fallback
    if (configSchema) {
      const resolved = resolveConfigWithEnv(config, configSchema as Record<string, ConfigFieldDescriptor>, {
        decrypt: false,
        maskSecrets: false,
      });

      // Check for missing required fields
      for (const [key, field] of Object.entries(configSchema)) {
        if (field.required && !resolved.values[key]) {
          const envHint = field.env
            ? ` or set ${field.env} in your environment`
            : "";
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Required field "${field.label || key}" is not configured. Please provide a value${envHint}.`,
          });
        }
      }
    }

    // SDK v2: Validate auth if auth fields changed
    if (metadata && authState && hasAuthChanges(input.configuration, metadata)) {
      console.log(`🔐 Auth fields changed for ${plugin.name}, validating credentials...`);

      try {
        const worker = pluginManagerService.getWorker(ctx.organizationId!, input.pluginId);

        // Only validate if worker is running (SDK v2)
        if (worker && worker.sdkVersion === "v2") {
          const abortController = new AbortController();
          const timeoutId = setTimeout(() => abortController.abort(), 10000);

          try {
            const response = await fetch(`http://localhost:${worker.port}/validate-auth`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ authState }),
              signal: abortController.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              throw new Error("Validation request failed");
            }

            const result = await response.json();

            if (!result.valid) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Auth validation failed: ${result.error || "Invalid credentials"}`,
              });
            }

            console.log(`✅ Auth validated for ${plugin.name}`);
          } catch (error: any) {
            clearTimeout(timeoutId);
            if (error.name === "AbortError") {
              throw new TRPCError({
                code: "TIMEOUT",
                message: "Auth validation timeout (>10s)",
              });
            }
            throw error;
          }
        } else {
          console.log(
            `ℹ️ Worker not running or SDK v1, skipping auth validation for ${plugin.name}`,
          );
        }
      } catch (error: any) {
        // If it's already a TRPCError, rethrow it
        if (error instanceof TRPCError) {
          throw error;
        }

        // Otherwise wrap it
        console.error(`❌ Auth validation failed for ${plugin.name}:`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Auth validation failed: ${error.message}`,
        });
      }
    }

    if (!instance) {
      // Create new instance if it doesn't exist
      const newInstance = await pluginInstanceRepository.enablePlugin(
        ctx.organizationId!,
        input.pluginId,
        config,
      );

      // SDK v2: Save auth state separately
      if (authState) {
        await pluginInstanceRepository.updateAuthState(
          newInstance.id,
          ctx.organizationId!,
          authState,
        );
      }

      return {
        success: true,
        instance: newInstance,
      };
    }

    // Update config (without auth fields)
    await pluginInstanceRepository.updateConfig(instance.id, config);

    // SDK v2: Update auth state separately if present
    if (authState) {
      await pluginInstanceRepository.updateAuthState(instance.id, ctx.organizationId!, authState);
    }

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
      instance: { ...instance, config, authState },
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
 *
 * Hybrid approach:
 * - Prefer live tools from running workers (fresh data)
 * - Fall back to database cache when workers offline
 * - Background refresh of cache when fetching from worker
 */
export const getMCPTools = authenticatedProcedure.query(async ({ ctx }) => {
  // Get all enabled plugin instances for this organization
  const instances = await pluginInstanceRepository.findByOrganization(ctx.organizationId!);
  const enabledInstances = instances.filter((i) => i.enabled);

  // Get all plugins
  const allPlugins = pluginManagerService.getAllPlugins();
  const pluginMap = new Map(allPlugins.map((p) => [p.id, p]));

  // Get plugin runner service for worker info
  const runnerV2Service = getPluginRunnerV2Service();

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
    const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];

    if (!capabilities.includes("mcp")) {
      continue;
    }

    let tools: any[] = [];

    // Try to fetch from running worker first (SDK v2)
    const workerInfo = runnerV2Service.getWorker(ctx.organizationId!, plugin.id);

    if (workerInfo) {
      // Worker is running - try to fetch fresh tools
      try {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 3000); // 3s timeout

        const response = await fetch(`http://localhost:${workerInfo.port}/mcp/list-tools`, {
          signal: abortController.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          tools = Array.isArray(data.tools) ? data.tools : [];

          // Background refresh of cache (non-blocking)
          if (tools.length > 0) {
            fetchAndStoreTools(workerInfo.port, ctx.organizationId!, plugin.id).catch((error) => {
              console.error(`Background tool cache refresh failed for ${plugin.id}:`, error);
            });
          }
        } else {
          // Worker fetch failed - fall back to database
          tools = getToolsFromConfig(instance.config);
        }
      } catch (error) {
        // Timeout or network error - fall back to database
        console.warn(`Failed to fetch tools from worker for ${plugin.id}:`, error);
        tools = getToolsFromConfig(instance.config);
      }
    } else {
      // No worker running - use database cache
      tools = getToolsFromConfig(instance.config);
    }

    // Add tools to result
    for (const tool of tools) {
      mcpTools.push({
        id: `${plugin.pluginId}:${tool.name}`, // Use pluginId (package name) not id (UUID)
        name: tool.name,
        label: tool.name,
        description: tool.description || "",
        pluginId: plugin.pluginId, // Plugin package ID (e.g., "@hay/email-plugin")
        pluginName: plugin.name,
      });
    }
  }

  return mcpTools;
});

/**
 * Helper function to extract tools from instance config
 */
function getToolsFromConfig(config: any): any[] {
  const tools: any[] = [];

  // Check local MCP servers
  if (config?.mcpServers?.local && Array.isArray(config.mcpServers.local)) {
    for (const server of config.mcpServers.local) {
      if (server.tools && Array.isArray(server.tools)) {
        tools.push(...server.tools);
      }
    }
  }

  // Check remote MCP servers
  if (config?.mcpServers?.remote && Array.isArray(config.mcpServers.remote)) {
    for (const server of config.mcpServers.remote) {
      if (server.tools && Array.isArray(server.tools)) {
        tools.push(...server.tools);
      }
    }
  }

  return tools;
}

/**
 * Manually refresh MCP tools for a specific plugin
 *
 * Useful after plugin updates or when tools need to be re-discovered
 */
export const refreshMCPTools = authenticatedProcedure
  .input(z.object({ pluginId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    // Get plugin
    const plugin = pluginManagerService.getPlugin(input.pluginId);
    if (!plugin) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Plugin ${input.pluginId} not found`,
      });
    }

    // Check if plugin has MCP capability
    const manifest = plugin.manifest as HayPluginManifest;
    const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];

    if (!capabilities.includes("mcp")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Plugin ${input.pluginId} does not have MCP capability`,
      });
    }

    // Get worker info
    const runnerV2Service = getPluginRunnerV2Service();
    const workerInfo = runnerV2Service.getWorker(ctx.organizationId!, input.pluginId);

    if (!workerInfo) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Plugin ${input.pluginId} is not running. Please enable the plugin first.`,
      });
    }

    // Fetch and store tools
    try {
      await fetchAndStoreTools(workerInfo.port, ctx.organizationId!, input.pluginId);
      return { success: true, message: "Tools refreshed successfully" };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to refresh tools: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
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
    console.log(`[testConnection] ===== Starting test for ${input.pluginId} =====`);
    console.log(`[testConnection] Organization ID: ${ctx.organizationId}`);

    const plugin = pluginManagerService.getPlugin(input.pluginId);

    if (!plugin) {
      console.log(`[testConnection] ❌ Plugin ${input.pluginId} not found in registry`);
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Plugin ${input.pluginId} not found`,
      });
    }

    const manifest = plugin.manifest as HayPluginManifest;
    console.log(`[testConnection] Plugin manifest capabilities:`, manifest.capabilities);
    console.log(`[testConnection] Plugin type:`, manifest.type);

    // Check if plugin has MCP capabilities (support both TypeScript-first array and legacy object format)
    const hasMcpCapability = Array.isArray(manifest.capabilities)
      ? manifest.capabilities.includes("mcp")
      : !!manifest.capabilities?.mcp;

    if (!hasMcpCapability) {
      console.log(`[testConnection] ❌ Plugin ${input.pluginId} does not have MCP capability`);
      return {
        success: false,
        status: "unhealthy",
        message: "Plugin does not support MCP connections",
        testedAt: new Date(),
      };
    }

    console.log(`[testConnection] ✅ Plugin has MCP capability`);

    // Check if plugin instance exists and has configuration
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      ctx.organizationId!,
      input.pluginId,
    );

    // Check if plugin requires authentication and if auth is configured
    // Use in-memory plugin metadata (more up-to-date than database)
    const authMethods = plugin.metadata?.authMethods;

    console.log(`[testConnection] Plugin instance status:`, {
      exists: !!instance,
      enabled: instance?.enabled,
      hasConfig: !!instance?.config,
      hasAuthState: !!instance?.authState,
      configKeys: instance?.config ? Object.keys(instance.config) : [],
      authMethods: authMethods?.map((m: any) => ({ type: m.type, id: m.id })) || [],
    });

    if (!instance) {
      console.log(`[testConnection] ❌ Plugin has no instance`);
      return {
        success: false,
        status: "unconfigured",
        message: "Plugin is not configured for this organization",
        testedAt: new Date(),
      };
    }

    // Check if plugin requires authentication
    if (authMethods && authMethods.length > 0) {
      // Plugin requires authentication - check if credentials are provided
      const configKeys = Object.keys(instance.config || {});
      const hasCredentials = configKeys.length > 0 && configKeys.some(key => {
        const value = instance.config![key];
        return value !== null && value !== undefined && value !== '';
      });

      if (!hasCredentials) {
        console.log(`[testConnection] ❌ Plugin requires authentication but no credentials configured`);
        return {
          success: false,
          status: "unconfigured",
          message: "Plugin requires authentication. Please configure your credentials.",
          testedAt: new Date(),
        };
      }
      console.log(`[testConnection] ✅ Plugin has required credentials configured`);
    }

    try {
      let mcpTools: any[] = [];

      // For SDK v2 plugins, start the worker if not already running
      console.log(`[testConnection] 🚀 Starting or getting existing worker...`);
      let worker;
      try {
        worker = await pluginManagerService.getOrStartWorker(ctx.organizationId!, input.pluginId);
        console.log(`[testConnection] ✅ Worker is running:`, {
          port: worker.port,
          startedAt: worker.startedAt,
        });
      } catch (workerStartError) {
        console.error(`[testConnection] ❌ Failed to start worker:`, workerStartError);
        return {
          success: false,
          status: "unhealthy",
          message: `Failed to start plugin worker: ${workerStartError instanceof Error ? workerStartError.message : String(workerStartError)}`,
          testedAt: new Date(),
        };
      }

      if (worker && worker.port) {
        // Use shared fetchToolsFromWorker service
        try {
          console.log(`[testConnection] 📡 Fetching tools from worker on port ${worker.port}...`);
          mcpTools = await fetchToolsFromWorker(worker.port, input.pluginId);
          console.log(
            `[testConnection] ✅ Fetched ${mcpTools.length} MCP tools from SDK v2 worker for ${input.pluginId}`,
          );
          if (mcpTools.length > 0) {
            console.log(`[testConnection] Tool names:`, mcpTools.map((t: any) => t.name));
          }
        } catch (workerError) {
          console.warn(
            `[testConnection] ⚠️  Failed to fetch tools from SDK v2 worker for ${input.pluginId}:`,
            workerError instanceof Error ? workerError.message : workerError,
          );
        }
      } else {
        console.log(`[testConnection] ⚠️  No worker running for ${input.pluginId}`);
      }

      // Fallback: Get MCP tools from database config (if worker call fails or no worker running)
      if (mcpTools.length === 0) {
        console.log(`[testConnection] 📦 Checking for cached tools in database config...`);
        mcpTools = getToolsFromConfig(instance.config);
        console.log(`[testConnection] Found ${mcpTools.length} cached tools in database`);
        if (mcpTools.length > 0) {
          console.log(`[testConnection] Cached tool names:`, mcpTools.map((t: any) => t.name));
        }
      }

      // Verify tools are registered
      if (mcpTools.length === 0) {
        console.log(`[testConnection] ❌ No tools found (neither from worker nor from database cache)`);
        return {
          success: false,
          status: "unhealthy",
          message: "No MCP tools registered yet - plugin may still be initializing",
          testedAt: new Date(),
        };
      }

      // Actually test the MCP server by calling a safe tool
      // Priority 1: Find READ-ONLY tools with NO required parameters (safest for health checks)
      const safeToolPrefixes = ["list_", "get_", "search_", "find_", "read_"];
      let testTool = mcpTools.find((t) => {
        const schema = t.inputSchema;
        const hasNoRequiredParams = !schema || !schema.required || schema.required.length === 0;
        const isReadOnly = safeToolPrefixes.some((prefix) => t.name.toLowerCase().startsWith(prefix));
        return hasNoRequiredParams && isReadOnly;
      });

      // Priority 2: Find any tool with NO required parameters
      if (!testTool) {
        testTool = mcpTools.find((t) => {
          const schema = t.inputSchema;
          if (!schema || !schema.required) return true;
          return schema.required.length === 0;
        });
      }

      // Priority 3: Find safe read-only tools (even if they have required params)
      if (!testTool) {
        testTool = mcpTools.find((t) =>
          safeToolPrefixes.some((prefix) => t.name.toLowerCase().startsWith(prefix)),
        );
      }

      // Priority 4: Just use the first tool as last resort
      if (!testTool) {
        testTool = mcpTools[0];
      }

      const hasRequiredParams = testTool.inputSchema?.required && testTool.inputSchema.required.length > 0;
      console.log(`[testConnection] Testing MCP connection by calling tool: ${testTool.name}`);
      console.log(`[testConnection] Tool has required parameters: ${hasRequiredParams}`);

      // Call the tool via worker (SDK v2) or legacy MCP client
      if (worker && worker.port) {
        // If the selected tool has required parameters, skip the actual call
        // and just verify the worker is responding
        if (hasRequiredParams) {
          console.log(
            `[testConnection] ⚠️  Selected tool has required parameters, skipping actual tool call`,
          );
          console.log(
            `[testConnection] ✅ Worker is running and tools are available - marking as healthy`,
          );
          return {
            success: true,
            status: "healthy",
            message: `MCP server is healthy - worker running with ${mcpTools.length} tools available (tool call skipped due to required parameters)`,
            tools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
            testedAt: new Date(),
          };
        }

        // SDK v2: Call tool via worker HTTP API (only if no required parameters)
        try {
          console.log(`[testConnection] 🔄 Calling tool with empty arguments for health check...`);
          const callResponse = await fetch(`http://localhost:${worker.port}/mcp/call-tool`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              toolName: testTool.name,
              arguments: {}, // Empty args for health check
            }),
            signal: AbortSignal.timeout(10000), // 10 second timeout
          });

          if (!callResponse.ok) {
            const errorText = await callResponse.text();
            console.log(
              `[testConnection] ❌ Tool call failed: HTTP ${callResponse.status} - ${errorText}`,
            );
            return {
              success: false,
              status: "unhealthy",
              message: `MCP tool call failed: HTTP ${callResponse.status} - ${errorText}`,
              tools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
              testedAt: new Date(),
            };
          }

          await callResponse.json();

          // Success - MCP server is responding
          console.log(`[testConnection] ✅ Tool call succeeded - MCP server is healthy`);
          return {
            success: true,
            status: "healthy",
            message: `MCP server is healthy - successfully called ${testTool.name}`,
            tools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
            testedAt: new Date(),
          };
        } catch (testError: any) {
          console.log(`[testConnection] ❌ Tool call failed with error: ${testError.message}`);
          return {
            success: false,
            status: "unhealthy",
            message: `MCP tool call failed: ${testError.message}`,
            tools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
            testedAt: new Date(),
          };
        }
      } else {
        // No worker - just return tools list as before (legacy behavior)
        return {
          success: true,
          status: "healthy",
          message: `Plugin has ${mcpTools.length} MCP tools registered (legacy mode - tool calling not tested)`,
          tools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
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
  .query(async ({ ctx, input }) => {
    const plugin = pluginManagerService.getPlugin(input.pluginId);
    if (!plugin) {
      return { available: false };
    }

    // Get plugin instance to check if credentials are configured
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      ctx.organizationId!,
      input.pluginId,
    );

    // Check if plugin has OAuth2 registered in metadata
    let oauthAvailable = false;
    let oauthConfigured = false;

    if (plugin.metadata?.authMethods) {
      const oauth2Method = plugin.metadata.authMethods.find(
        (method: AuthMethodDescriptor) => method.type === "oauth2",
      );
      if (oauth2Method) {
        oauthAvailable = true;

        // Check if OAuth credentials are configured
        if (instance && oauth2Method.clientId && oauth2Method.clientSecret) {
          const decryptedConfig = instance.config ? decryptConfig(instance.config) : {};

          const hasClientId = !!(
            decryptedConfig[oauth2Method.clientId] ||
            instance.authState?.credentials?.[oauth2Method.clientId]
          );
          const hasClientSecret = !!(
            decryptedConfig[oauth2Method.clientSecret] ||
            instance.authState?.credentials?.[oauth2Method.clientSecret]
          );

          oauthConfigured = hasClientId && hasClientSecret;
        }
      }
    }

    // OAuth is only available if both registered AND configured
    return { available: oauthAvailable && oauthConfigured };
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

/**
 * Validate auth credentials (SDK v2)
 *
 * Calls the plugin worker's /validate-auth endpoint to validate credentials
 */
export const validateAuth = authenticatedProcedure
  .input(
    z.object({
      pluginId: z.string(),
      authState: z.object({
        methodId: z.string(),
        credentials: z.record(z.any()),
      }),
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

    // Get or start worker
    const worker = await pluginManagerService.getOrStartWorker(ctx.organizationId!, input.pluginId);

    // Call plugin's validation endpoint with timeout
    // SDK v2 runner exposes: POST /validate-auth
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 10000); // 10 second timeout

    try {
      const response = await fetch(`http://localhost:${worker.port}/validate-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authState: input.authState,
        }),
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error("Validation request failed");
      }

      const result = await response.json();

      // Return validation result
      return {
        valid: result.valid,
        error: result.error,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as any).name === "AbortError") {
        return {
          valid: false,
          error: "Validation timeout (>10s)",
        };
      }
      throw error;
    }
  });

// Note: Plugin UI assets are now served via HTTP endpoint at /plugins/ui/:pluginName/:assetPath
// See server/main.ts for the Express route handler and server/services/plugin-asset.service.ts for implementation
