/**
 * Plugin SDK Type Definitions
 *
 * These types define the contract between Hay Core and the Plugin SDK.
 * The SDK uses a minimal manifest approach where metadata is fetched at runtime.
 */

// ============================================================================
// Manifest Types (Minimal - from package.json)
// ============================================================================

/**
 * Minimal manifest stored in package.json "hay-plugin" block
 * This replaces the legacy HayPluginManifest with a simpler structure.
 *
 * Config schema, auth methods, and UI extensions are NOT in the manifest.
 * They are fetched from the /metadata endpoint at runtime.
 */
export interface HayPluginManifest {
  /** Entry point file (e.g., "./dist/index.js") */
  entry: string;

  /** Display name shown in UI (e.g., "Shopify") */
  displayName: string;

  /** Plugin category (e.g., "integration", "analytics") */
  category: string;

  /** Plugin capabilities array (e.g., ["routes", "mcp", "auth", "config", "ui"]) */
  capabilities: string[];

  /** Allowed environment variables (e.g., ["SHOPIFY_API_KEY"]) */
  env?: string[];
}

// ============================================================================
// Plugin-Global Metadata State
// ============================================================================

/**
 * Plugin-global metadata state (not org-specific)
 * Stored in PluginRegistry.metadataState
 */
export type PluginMetadataState =
  | "missing" // Metadata not yet fetched
  | "fresh" // Metadata cached and valid
  | "stale" // Code changed (checksum mismatch), needs refetch
  | "error"; // Metadata fetch failed

/**
 * Plugin metadata response from GET /metadata endpoint
 * This is the result of onInitialize() hook execution.
 * Stored in PluginRegistry.metadata
 */
export interface PluginMetadata {
  configSchema: Record<string, ConfigFieldDescriptor>;
  authMethods: AuthMethodDescriptor[];
  uiExtensions: UIExtensionDescriptor[];
  routes: RouteDescriptor[];
  mcp: {
    local: LocalMcpDescriptor[];
    external: ExternalMcpDescriptor[];
  };
}

// ============================================================================
// Org-Scoped Runtime State
// ============================================================================

/**
 * Org-scoped runtime state (worker lifecycle per org+plugin)
 * Stored in PluginInstance.runtimeState
 */
export type PluginInstanceRuntimeState =
  | "stopped" // Worker not running
  | "starting" // Worker spawning, waiting for /metadata
  | "ready" // Worker running, healthy
  | "degraded" // Worker running but MCP/config issues
  | "error"; // Worker crashed or failed to start

/**
 * Authentication state for a plugin instance
 * Stored in PluginInstance.authState
 */
export interface AuthState {
  /** Auth method ID (e.g., "apiKey", "oauth") */
  methodId: string;

  /** Credentials (e.g., { apiKey: "..." } or { accessToken: "...", refreshToken: "..." }) */
  credentials: Record<string, any>;
}

// ============================================================================
// Metadata Schema Types
// ============================================================================

/**
 * Config field descriptor (from /metadata endpoint)
 */
export interface ConfigFieldDescriptor {
  type: "string" | "number" | "boolean" | "json";
  label: string;
  description?: string;
  placeholder?: string; // Placeholder text for input field in UI
  required?: boolean;
  encrypted?: boolean;
  default?: any;
  env?: string; // Environment variable fallback
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: any[];
  };
}

/**
 * Auth method descriptor (from /metadata endpoint)
 */
export interface AuthMethodDescriptor {
  /** Auth method ID (e.g., "apiKey", "oauth") */
  id: string;

  /** Auth type */
  type: "apiKey" | "oauth2";

  /** Display label */
  label: string;

  /** For API key auth: config field reference */
  configField?: string;

  /** For OAuth2 auth: authorization URL */
  authorizationUrl?: string;

  /** For OAuth2 auth: token URL */
  tokenUrl?: string;

  /** For OAuth2 auth: scopes */
  scopes?: string[];

  /** For OAuth2 auth: optional scopes */
  optionalScopes?: string[];

  /** For OAuth2 auth: client ID config field name */
  clientId?: string;

  /** For OAuth2 auth: client secret config field name */
  clientSecret?: string;

  /** For OAuth2 auth: client ID env var */
  clientIdEnv?: string;

  /** For OAuth2 auth: client secret env var */
  clientSecretEnv?: string;
}

/**
 * UI extension descriptor (from /metadata endpoint)
 */
export interface UIExtensionDescriptor {
  id: string;
  slot: string; // e.g., "plugin-settings", "conversation-sidebar"
  component: string; // Vue component path
  props?: Record<string, any>;
}

/**
 * Route descriptor (from /metadata endpoint)
 */
export interface RouteDescriptor {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  description?: string;
}

/**
 * Local MCP descriptor (from /metadata endpoint)
 */
export interface LocalMcpDescriptor {
  serverId: string;
  description?: string;
  status: "available" | "unavailable";
}

/**
 * External MCP descriptor (from /metadata endpoint)
 */
export interface ExternalMcpDescriptor {
  serverId: string;
  description?: string;
  url?: string;
  status: "available" | "unavailable";
}

// ============================================================================
// MCP Tool Types
// ============================================================================

/**
 * MCP tool definition (from GET /mcp/list-tools)
 */
export interface MCPTool {
  serverId: string;
  name: string;
  description: string;
  input_schema: Record<string, any>;
  organizationId: string;
  pluginId: string;
}

// ============================================================================
// Worker Info Types
// ============================================================================

/**
 * Worker process information
 */
export interface WorkerInfo {
  process: any; // ChildProcess
  port: number;
  startedAt: Date;
  lastActivity: Date;
  organizationId: string;
  pluginId: string;
  instanceId: string;
  sdkVersion: "v1" | "v2";
  metadata?: any; // Plugin registry metadata (for compatibility with legacy code)
}
