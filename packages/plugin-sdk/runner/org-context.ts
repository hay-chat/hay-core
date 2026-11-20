/**
 * Hay Plugin SDK - Org Runtime Context Factory
 *
 * Creates org-specific runtime contexts for hooks like onStart, onValidateAuth, etc.
 *
 * @module @hay/plugin-sdk/runner/org-context
 */

import type {
  HayStartContext,
  HayAuthValidationContext,
  HayConfigUpdateContext,
  HayDisableContext,
  HayOrg,
  AuthState,
} from "../types/index.js";
import { PluginRegistry } from "../sdk/registry.js";
import { createConfigRuntimeAPI } from "../sdk/config-runtime.js";
import { createAuthRuntimeAPI } from "../sdk/auth-runtime.js";
import { createMcpRuntimeAPI } from "../sdk/mcp-runtime.js";
import { createProductSourceRuntime } from "../sdk/product-source-runtime.js";
import { createDisputeSourceRuntime } from "../sdk/dispute-source-runtime.js";
import { CredentialStore } from "../sdk/credential-store.js";
import type { HayLogger } from "../types/index.js";
import type { HayPluginManifest } from "../types/index.js";

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
 * @param pluginPath - Absolute path to the plugin directory
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
  pluginPath: string,
  onMcpServerStarted?: (server: any) => void | Promise<void>,
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
    pluginDir: pluginPath, // Use the absolute plugin path from runner
    // Platform callback - registers MCP servers with HTTP server
    onMcpServerStarted: async (server) => {
      logger.info("MCP server started", { id: server.id, type: server.type });
      if (onMcpServerStarted) {
        await Promise.resolve(onMcpServerStarted(server));
      }
    },
  });

  // Inject the product-source runtime API only when the plugin declares the
  // `products` capability. The HAY_API_URL + HAY_API_TOKEN envs are already
  // injected by core's plugin-runner.service.
  const declaresProducts =
    Array.isArray(manifest.capabilities) && manifest.capabilities.includes("products");
  const productSourceAPI =
    declaresProducts && process.env.HAY_API_URL && process.env.HAY_API_TOKEN
      ? createProductSourceRuntime({
          apiUrl: process.env.HAY_API_URL,
          apiToken: process.env.HAY_API_TOKEN,
          logger,
        })
      : undefined;

  const declaresDisputes =
    Array.isArray(manifest.capabilities) && manifest.capabilities.includes("disputes");
  const disputesAPI =
    declaresDisputes && process.env.HAY_API_URL && process.env.HAY_API_TOKEN
      ? createDisputeSourceRuntime({
          apiUrl: process.env.HAY_API_URL,
          apiToken: process.env.HAY_API_TOKEN,
          logger,
        })
      : undefined;

  return {
    org: orgData.org,
    config: configAPI,
    auth: authAPI,
    mcp: mcpAPI,
    productSource: productSourceAPI,
    disputes: disputesAPI,
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
  logger: HayLogger,
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
  logger: HayLogger,
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
  logger: HayLogger,
): HayDisableContext {
  return {
    org: orgData.org,
    logger,
  };
}

/**
 * Load org runtime data: the non-secret settings core put in the environment,
 * plus every credential the manifest declares, pulled from core.
 *
 * @returns Org runtime data and the store that keeps its secrets fresh
 * @throws Error if the settings are missing or malformed, or core refuses a credential
 *
 * @remarks
 * Expects `HAY_ORG_SETTINGS`: JSON `{ org: { id }, config, authMethodId }`. It holds
 * no secret field and no token; those are pulled with `HAY_API_TOKEN`.
 */
export async function loadOrgData(
  manifest: HayPluginManifest,
  logger: HayLogger,
): Promise<{ orgData: OrgRuntimeData; credentials: CredentialStore }> {
  const raw = process.env.HAY_ORG_SETTINGS;
  if (!raw) {
    throw new Error("Missing required environment variable: HAY_ORG_SETTINGS");
  }

  let settings: {
    org?: { id?: string; name?: string };
    config?: Record<string, unknown>;
    authMethodId?: string | null;
  };
  try {
    settings = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse HAY_ORG_SETTINGS as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!settings.org?.id) {
    throw new Error("HAY_ORG_SETTINGS must include org.id");
  }

  const declarations = manifest.credentials ?? [];
  const apiUrl = process.env.HAY_API_URL;
  const apiToken = process.env.HAY_API_TOKEN;
  if (declarations.length > 0 && (!apiUrl || !apiToken)) {
    throw new Error("HAY_API_URL and HAY_API_TOKEN are required to pull credentials");
  }

  const credentials = new CredentialStore({
    declarations,
    settings: settings.config ?? {},
    authMethodId: settings.authMethodId ?? null,
    apiUrl: apiUrl ?? "",
    apiToken: apiToken ?? "",
    logger,
  });
  await credentials.refreshAll();

  return {
    orgData: {
      org: { id: settings.org.id, name: settings.org.name },
      config: credentials.config,
      auth: credentials.authState,
    },
    credentials,
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
