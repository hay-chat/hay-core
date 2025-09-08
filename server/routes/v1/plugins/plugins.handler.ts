import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authenticatedProcedure } from "@server/trpc";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { pluginUIService } from "@server/services/plugin-ui.service";
import type { HayPluginManifest } from "@server/types/plugin.types";

/**
 * Get all available plugins
 */
export const getAllPlugins = authenticatedProcedure
  .query(async ({ ctx }) => {
    const plugins = pluginManagerService.getAllPlugins();
    
    // Get enabled instances for this organization
    const instances = await pluginInstanceRepository.findByOrganization(ctx.organizationId!);
    const enabledPluginIds = new Set(instances.filter(i => i.enabled).map(i => i.pluginId));
    
    // Debug logging
    console.log("🔍 [HAY DEBUG] getAllPlugins:");
    console.log("  - Registry plugins:", plugins.map(p => ({ id: p.id, pluginId: p.pluginId, name: p.name })));
    console.log("  - Enabled instances:", instances.filter(i => i.enabled).map(i => ({ pluginId: i.pluginId })));
    console.log("  - EnabledPluginIds Set:", Array.from(enabledPluginIds));
    
    return plugins.map(plugin => {
      const manifest = plugin.manifest as HayPluginManifest;
      const result = {
        id: plugin.pluginId,  // Use pluginId as the identifier for frontend
        dbId: plugin.id,      // Keep database ID for reference
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
      };
      console.log(`  - Returning plugin ${plugin.name}:`, { id: result.id, dbId: result.dbId, enabled: result.enabled });
      return result;
    });
  });

/**
 * Get a specific plugin by ID
 */
export const getPlugin = authenticatedProcedure
  .input(z.object({
    pluginId: z.string(),
  }))
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
      id: plugin.pluginId,  // Use pluginId as the identifier
      dbId: plugin.id,      // Keep database ID for reference
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
export const getPluginInstances = authenticatedProcedure
  .query(async ({ ctx }) => {
    return await pluginInstanceRepository.findByOrganization(ctx.organizationId!);
  });

/**
 * Enable a plugin for the organization
 */
export const enablePlugin = authenticatedProcedure
  .input(z.object({
    pluginId: z.string(),
    configuration: z.record(z.any()).optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    const plugin = pluginManagerService.getPlugin(input.pluginId);
    
    if (!plugin) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Plugin ${input.pluginId} not found`,
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
        plugin.id,
        input.configuration || {}
      );
      
      console.log(`✅ [HAY OK] Plugin ${plugin.name} successfully enabled`);
      
      return {
        success: true,
        instance,
      };
    } catch (error) {
      console.error(`❌ [HAY FAILED] Failed to enable plugin ${plugin.name}:`, error);
      
      // Extract the most relevant error message
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        // Clean up the error message for the user
        errorMessage = error.message
          .replace(/Failed to \w+ plugin hay-plugin-\w+: /, '') // Remove redundant prefix
          .replace(/Error: /, '') // Remove Error: prefix
          .replace(/Command failed: /, 'Command failed: '); // Keep command failed for clarity
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
  .input(z.object({
    pluginId: z.string(),
  }))
  .mutation(async ({ ctx, input }) => {
    const plugin = pluginManagerService.getPlugin(input.pluginId);
    if (!plugin) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Plugin ${input.pluginId} not found`,
      });
    }
    
    await pluginInstanceRepository.disablePlugin(
      ctx.organizationId!,
      plugin.id
    );
    
    return {
      success: true,
    };
  });

/**
 * Configure a plugin
 */
export const configurePlugin = authenticatedProcedure
  .input(z.object({
    pluginId: z.string(),
    configuration: z.record(z.any()),
  }))
  .mutation(async ({ ctx, input }) => {
    const plugin = pluginManagerService.getPlugin(input.pluginId);
    if (!plugin) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Plugin ${input.pluginId} not found`,
      });
    }
    
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      ctx.organizationId!,
      plugin.id
    );
    
    if (!instance) {
      // Create new instance if it doesn't exist
      const newInstance = await pluginInstanceRepository.enablePlugin(
        ctx.organizationId!,
        plugin.id,
        input.configuration
      );
      
      return {
        success: true,
        instance: newInstance,
      };
    }
    
    await pluginInstanceRepository.updateConfig(instance.id, input.configuration);
    
    return {
      success: true,
      instance: { ...instance, config: input.configuration },
    };
  });

/**
 * Get plugin configuration
 */
export const getPluginConfiguration = authenticatedProcedure
  .input(z.object({
    pluginId: z.string(),
  }))
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
      plugin.id
    );
    
    if (!instance) {
      // Return default configuration from manifest
      const manifest = plugin.manifest as HayPluginManifest;
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
      };
    }
    
    return {
      configuration: instance.config || {},
      enabled: instance.enabled,
    };
  });

/**
 * Get UI template for plugin configuration
 */
export const getPluginUITemplate = authenticatedProcedure
  .input(z.object({
    pluginId: z.string(),
  }))
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
export const getMCPTools = authenticatedProcedure
  .query(async ({ ctx }) => {
    // Get all enabled plugin instances for this organization
    const instances = await pluginInstanceRepository.findByOrganization(ctx.organizationId!);
    const enabledInstances = instances.filter(i => i.enabled);
    
    // Get all plugins and filter to only enabled ones
    const allPlugins = pluginManagerService.getAllPlugins();
    const enabledPluginIds = new Set(enabledInstances.map(i => i.pluginId));
    
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
          description: tool.description || '',
          pluginId: plugin.pluginId,
          pluginName: plugin.name,
        });
      }
    }
    
    return mcpTools;
  });