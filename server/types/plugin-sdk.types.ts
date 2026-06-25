/**
 * Plugin SDK Type Definitions
 *
 * These types define the contract between Hay Core and the Plugin SDK.
 * The SDK uses a minimal manifest approach where metadata is fetched at runtime.
 */

import type { ChildProcess } from "child_process";

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
  /** Plugin-declared cron jobs (from register.cron). Optional for older plugins. */
  crons?: CronJobDescriptor[];
  /**
   * Plugin-declared webhook routing strategy (from register.webhookRouting).
   * Present only for plugins that fan a single shared webhook URL out to
   * per-org workers. Absent for normal per-org webhooks.
   */
  webhookRouting?: WebhookRoutingDescriptor;
}

// ============================================================================
// Webhook Routing Descriptor (shared-app fan-out)
// ============================================================================

/**
 * Signature verification descriptor.
 *
 * Mirrors the SDK's WebhookSignatureDescriptor. Core verifies an HMAC-SHA256
 * over the exact raw request bytes using `process.env[secretEnv]` and
 * timing-safe compares against the named header.
 */
export interface WebhookSignatureDescriptor {
  header: string;
  format: "sha256-hmac";
  secretEnv: string;
}

/**
 * Verification-challenge (GET handshake) descriptor.
 *
 * Mirrors the SDK's WebhookVerificationChallengeDescriptor.
 */
export interface WebhookVerificationChallengeDescriptor {
  modeParam: string;
  verifyTokenParam: string;
  challengeParam: string;
  verifyTokenConfigField?: string;
  verifyTokenEnv?: string;
}

/**
 * Route-key extraction descriptor (minimal, no-eval dot-paths).
 *
 * Mirrors the SDK's WebhookRouteKeyPathDescriptor.
 */
export interface WebhookRouteKeyPathDescriptor {
  itemsPath: string;
  keyPath: string;
}

/**
 * Full webhook routing strategy a plugin declares.
 *
 * Mirrors the SDK's WebhookRoutingDescriptor. Read from plugin metadata and
 * executed blindly by the generic webhook router; Core gains no provider
 * knowledge.
 */
export interface WebhookRoutingDescriptor {
  signature: WebhookSignatureDescriptor;
  verificationChallenge?: WebhookVerificationChallengeDescriptor;
  routeKeyPath: WebhookRouteKeyPathDescriptor;
}

/**
 * Cron job descriptor (from /metadata endpoint).
 *
 * Mirrors the SDK's CronJobDescriptor — the schedule + retry policy Hay Core
 * needs to register the job per enabled org. The handler itself lives in the
 * plugin worker and is invoked via POST /cron/:name.
 */
export interface CronJobDescriptor {
  name: string;
  schedule: string;
  retryPolicy?: {
    maxRetries?: number;
    backoff?: "fixed" | "exponential";
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
  credentials: Record<string, unknown>;
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
  default?: unknown;
  env?: string; // Environment variable fallback
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: unknown[];
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

  /** For OAuth2 auth: extra static query params appended to the authorize URL */
  authorizationParams?: Record<string, string>;

  /** For OAuth2 auth: delimiter used to join scopes in the authorize URL (defaults to a space) */
  scopeSeparator?: string;

  /** For OAuth2 auth: one-time token transform run after the code exchange (e.g. short→long). */
  tokenExchange?: OAuthTokenOpDescriptor;

  /** For OAuth2 auth: custom refresh strategy used instead of the standard refresh_token grant. */
  tokenRefresh?: OAuthTokenOpDescriptor;
}

/** Declarative token operation (exchange/refresh) executed as a single GET request. */
export interface OAuthTokenOpDescriptor {
  url: string;
  grantType: string;
  tokenParam: string;
  includeClientSecret?: boolean;
}

/**
 * UI extension descriptor (from /metadata endpoint)
 */
export interface UIExtensionDescriptor {
  id: string;
  slot: string; // e.g., "plugin-settings", "conversation-sidebar"
  component: string; // Vue component path
  props?: Record<string, unknown>;
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
// Document Importer Contract
// ============================================================================

/** A logical root inside a document source (Confluence space, GitHub repo, Notion DB). */
export interface DocumentImporterRoot {
  id: string;
  label: string;
  metadata?: Record<string, unknown>;
}

/** A page descriptor returned by discover() / listChanges() — minimal metadata only. */
export interface DocumentImporterExternalPage {
  externalId: string;
  title: string;
  externalUpdatedAt: string; // ISO 8601
  externalUrl?: string;
  metadata?: Record<string, unknown>;
}

/** Full fetched page content returned by fetchPage(). */
export interface DocumentImporterFetchedPage {
  externalId: string;
  title: string;
  markdown: string;
  externalUpdatedAt: string;
  externalUrl?: string;
  attachments?: Array<{ name: string; url: string; mimeType?: string }>;
}

export type DocumentImporterChangeOp = "upsert" | "delete";

export interface DocumentImporterPageChange {
  externalId: string;
  op: DocumentImporterChangeOp;
  externalUpdatedAt?: string;
}

/**
 * Contract that a 'document_importer' plugin's tRPC sub-router must implement.
 * Core resolves the plugin's router via PluginRouterRegistry and calls these procedures
 * from the document-source sync service.
 */
export interface DocumentImporterContract {
  listRoots(input: { instanceId: string }): Promise<DocumentImporterRoot[]>;
  discover(input: { instanceId: string; rootId: string; cursor?: string }): Promise<{
    pages: DocumentImporterExternalPage[];
    nextCursor?: string;
    /**
     * Optional hint: total number of pages the importer expects to enumerate
     * for this root. Lets the sync engine report "X of Y" progress. Importers
     * that can't know this up front (e.g. cursor-only APIs) may omit it.
     */
    total?: number;
  }>;
  fetchPage(input: {
    instanceId: string;
    externalId: string;
  }): Promise<DocumentImporterFetchedPage>;
  listChanges(input: {
    instanceId: string;
    rootId: string;
    since: string;
    cursor?: string;
  }): Promise<{
    changes: DocumentImporterPageChange[];
    nextCursor?: string;
  }>;
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
  input_schema: Record<string, unknown>;
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
  process: ChildProcess;
  port: number;
  startedAt: Date;
  lastActivity: Date;
  organizationId: string;
  pluginId: string;
  instanceId: string;
  metadata?: PluginMetadata; // Plugin registry metadata
}
