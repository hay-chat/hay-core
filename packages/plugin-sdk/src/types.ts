import { Request, Response, NextFunction } from 'express';

// ============================================================================
// Plugin Metadata
// ============================================================================

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  category?: string;
  icon?: string;
  capabilities: PluginCapabilityType[];
  config?: Record<string, ConfigFieldDefinition>;
  auth?: PluginAuthConfig;
  ui?: {
    settings?: boolean;
  };
  marketplace?: {
    featured?: boolean;
    tags?: string[];
  };
}

export interface PluginAuthConfig {
  type: 'oauth2' | 'apiKey' | 'basic' | 'none';
  // OAuth2 specific fields
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  optionalScopes?: string[];
  pkce?: boolean;
  clientIdEnvVar?: string;
  clientSecretEnvVar?: string;
}

export type PluginCapabilityType =
  | 'routes'
  | 'messages'
  | 'customers'
  | 'sources'
  | 'mcp';

export interface ConfigFieldDefinition {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  label?: string;
  description?: string;
  required?: boolean;
  encrypted?: boolean;
  envVar?: string; // Maps to environment variable
  default?: any;
  validation?: {
    min?: number;
    max?: number;
    regex?: string;
    enum?: any[];
  };
}

/**
 * Configuration field schema for UI form generation
 * Used by registerConfigOption() to define configuration fields
 */
export interface ConfigFieldSchema {
  type: 'string' | 'number' | 'boolean' | 'select' | 'textarea';
  label?: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  encrypted?: boolean;  // Marks as sensitive (password field, masked after save)
  env?: string;         // Maps to environment variable name
  default?: any;        // Default value
  options?: Array<{ label: string; value: any }>;  // For select type
}

/**
 * Settings extension for plugin UI customization
 * Used by registerUIExtension() to add custom components to the settings page
 */
export interface SettingsExtension {
  slot: 'before-settings' | 'after-settings' | 'tab';
  component: string;
  tabName?: string;
  tabOrder?: number;
  props?: Record<string, any>;
}

// ============================================================================
// Plugin SDK Configuration
// ============================================================================

export interface PluginSDKConfig {
  apiUrl: string; // http://localhost:3001
  apiToken: string; // JWT token
  capabilities: string[];
}

// ============================================================================
// Messages Capability
// ============================================================================

export interface ReceiveMessageOptions {
  from: string;
  content: string;
  channel: string;
  metadata?: Record<string, any>;
}

export interface ReceiveMessageResult {
  messageId: string;
  conversationId: string;
  processed: boolean;
}

export interface SendMessageOptions {
  to: string;
  content: string;
  channel: string;
  conversationId?: string;
  metadata?: Record<string, any>;
}

export interface SendMessageResult {
  messageId: string;
  conversationId: string;
  timestamp: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  content: string;
  type: 'customer' | 'agent' | 'system';
  metadata?: Record<string, any>;
  createdAt: Date;
}

// ============================================================================
// Customers Capability
// ============================================================================

export interface Customer {
  id: string;
  organizationId: string;
  externalId: string;
  email?: string;
  phone?: string;
  name?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertCustomerOptions {
  externalId: string;
  channel: string;
  email?: string;
  phone?: string;
  name?: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// Sources Capability
// ============================================================================

export interface RegisterSourceOptions {
  id: string;
  name: string;
  category: 'messaging' | 'social' | 'email' | 'helpdesk';
  icon?: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// MCP Capability
// ============================================================================

export interface LocalMCPConfig {
  serverId?: string; // Auto-generated if not provided
  serverPath: string;
  startCommand: string;
  installCommand?: string;
  buildCommand?: string;
  tools?: MCPToolDefinition[]; // Optional - will be discovered from MCP server
  env?: Record<string, string>;
}

export interface RemoteMCPConfig {
  serverId?: string; // Auto-generated if not provided
  url: string;
  transport: 'http' | 'sse' | 'websocket';
  auth?: {
    type: 'bearer' | 'apiKey' | 'oauth2';
    token?: string;
    apiKey?: string;
    // OAuth2 configuration
    authorizationUrl?: string;
    tokenUrl?: string;
    scopes?: string[];
    optionalScopes?: string[];
    pkce?: boolean;
    clientIdEnvVar?: string;
    clientSecretEnvVar?: string;
  };
  tools?: MCPToolDefinition[]; // Optional - will be discovered from MCP server
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

// ============================================================================
// Route Registration
// ============================================================================

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export type RouteHandler = (
  req: Request,
  res: Response,
  next?: NextFunction
) => void | Promise<void>;

// ============================================================================
// Re-exports from Express
// ============================================================================

export { Request, Response, NextFunction } from 'express';
