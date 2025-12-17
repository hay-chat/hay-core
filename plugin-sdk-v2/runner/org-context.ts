/**
 * Hay Plugin SDK v2 - Org Runtime Context Factory
 *
 * Creates org-specific runtime contexts for hooks like onStart, onValidateAuth, etc.
 *
 * @module @hay/plugin-sdk-v2/runner/org-context
 */

import type {
  HayStartContext,
  HayAuthValidationContext,
  HayConfigUpdateContext,
  HayDisableContext,
  HayOrg,
  AuthState,
} from '../types/index.js';
import { PluginRegistry } from '../sdk/registry.js';
import { createConfigRuntimeAPI } from '../sdk/config-runtime.js';
import { createAuthRuntimeAPI } from '../sdk/auth-runtime.js';
import { createMcpRuntimeAPI } from '../sdk/mcp-runtime.js';
import type { HayLogger } from '../types/index.js';
import type { HayPluginManifest } from '../types/index.js';

/**
 * Org runtime data loaded from environment or mock.
 */
export interface OrgRuntimeData {
  /**
   * Organization info
   */
  org: HayOrg;

  /**
   * Organization-specific config values
   */
  config: Record<string, any>;

  /**
   * Organization-specific auth state (null if not configured)
   */
  auth: AuthState | null;
}

/**
 * Create a start context for onStart hook.
 *
 * @param orgData - Org runtime data
 * @param registry - Plugin registry
 * @param manifest - Plugin manifest
 * @param logger - Logger instance
 * @param onMcpServerStarted - Optional callback when MCP server is started
 * @returns Start context instance
 *
 * @see PLUGIN.md Section 5.3 (lines 453-577)
 */
export function createStartContext(
  orgData: OrgRuntimeData,
  registry: PluginRegistry,
  manifest: HayPluginManifest,
  logger: HayLogger,
  onMcpServerStarted?: (server: any) => void | Promise<void>
): HayStartContext {
  const configAPI = createConfigRuntimeAPI({
    orgConfig: orgData.config,
    registry,
    manifest: { env: manifest.env },
    logger,
  });

  const authAPI = createAuthRuntimeAPI({
    authState: orgData.auth,
    logger,
  });

  const mcpAPI = createMcpRuntimeAPI({
    config: configAPI,
    auth: authAPI,
    logger,
    // Platform callback - registers MCP servers with HTTP server
    onMcpServerStarted: async (server) => {
      logger.info('MCP server started', { id: server.id, type: server.type });
      if (onMcpServerStarted) {
        await Promise.resolve(onMcpServerStarted(server));
      }
    },
  });

  return {
    org: orgData.org,
    config: configAPI,
    auth: authAPI,
    mcp: mcpAPI,
    logger,
  };
}

/**
 * Create an auth validation context for onValidateAuth hook.
 *
 * @param orgData - Org runtime data
 * @param registry - Plugin registry
 * @param manifest - Plugin manifest
 * @param logger - Logger instance
 * @returns Auth validation context instance
 *
 * @see PLUGIN.md Section 5.4 (lines 580-590)
 */
export function createAuthValidationContext(
  orgData: OrgRuntimeData,
  registry: PluginRegistry,
  manifest: HayPluginManifest,
  logger: HayLogger
): HayAuthValidationContext {
  const configAPI = createConfigRuntimeAPI({
    orgConfig: orgData.config,
    registry,
    manifest: { env: manifest.env },
    logger,
  });

  const authAPI = createAuthRuntimeAPI({
    authState: orgData.auth,
    logger,
  });

  return {
    org: orgData.org,
    config: configAPI,
    auth: authAPI,
    logger,
  };
}

/**
 * Create a config update context for onConfigUpdate hook.
 *
 * @param orgData - Org runtime data
 * @param registry - Plugin registry
 * @param manifest - Plugin manifest
 * @param logger - Logger instance
 * @returns Config update context instance
 *
 * @see PLUGIN.md Section 5.5 (lines 592-601)
 */
export function createConfigUpdateContext(
  orgData: OrgRuntimeData,
  registry: PluginRegistry,
  manifest: HayPluginManifest,
  logger: HayLogger
): HayConfigUpdateContext {
  const configAPI = createConfigRuntimeAPI({
    orgConfig: orgData.config,
    registry,
    manifest: { env: manifest.env },
    logger,
  });

  return {
    org: orgData.org,
    config: configAPI,
    logger,
  };
}

/**
 * Create a disable context for onDisable hook.
 *
 * @param orgData - Org runtime data
 * @param logger - Logger instance
 * @returns Disable context instance
 *
 * @see PLUGIN.md Section 5.6 (lines 603-613)
 */
export function createDisableContext(
  orgData: OrgRuntimeData,
  logger: HayLogger
): HayDisableContext {
  return {
    org: orgData.org,
    logger,
  };
}

/**
 * Load org runtime data from environment variables.
 *
 * @returns Org runtime data
 * @throws Error if env vars are missing or malformed
 *
 * @remarks
 * Expects:
 * - `HAY_ORG_CONFIG`: JSON string with org config
 * - `HAY_ORG_AUTH`: JSON string with org auth state (optional)
 */
export function loadOrgDataFromEnv(): OrgRuntimeData {
  // Load org config
  const orgConfigEnv = process.env.HAY_ORG_CONFIG;
  if (!orgConfigEnv) {
    throw new Error('Missing required environment variable: HAY_ORG_CONFIG');
  }

  let orgConfigData: any;
  try {
    orgConfigData = JSON.parse(orgConfigEnv);
  } catch (err) {
    throw new Error(
      `Failed to parse HAY_ORG_CONFIG as JSON: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // Validate org config structure
  if (!orgConfigData.org || !orgConfigData.org.id) {
    throw new Error('HAY_ORG_CONFIG must include org.id');
  }

  // Load org auth (optional)
  let authState: AuthState | null = null;
  const orgAuthEnv = process.env.HAY_ORG_AUTH;
  if (orgAuthEnv) {
    try {
      authState = JSON.parse(orgAuthEnv);
    } catch (err) {
      throw new Error(
        `Failed to parse HAY_ORG_AUTH as JSON: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return {
    org: {
      id: orgConfigData.org.id,
      name: orgConfigData.org.name,
    },
    config: orgConfigData.config || {},
    auth: authState,
  };
}

/**
 * Create mock org runtime data for testing.
 *
 * @param orgId - Organization ID
 * @returns Mock org runtime data
 */
export function createMockOrgData(orgId: string): OrgRuntimeData {
  return {
    org: {
      id: orgId,
      name: `Test Org ${orgId}`,
    },
    config: {
      // Mock config values (plugin can override via env vars)
    },
    auth: null, // No auth by default in test mode
  };
}
