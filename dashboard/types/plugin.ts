/**
 * Plugin-related type definitions for the dashboard
 */

/**
 * Plugin configuration update payload
 */
export interface PluginConfigUpdate {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Plugin test result
 */
export interface PluginTestResult {
  success: boolean;
  message?: string;
  error?: string;
  status?: "unconfigured" | "error" | "success";
}

/**
 * Plugin metadata
 */
export interface PluginMetadata {
  id: string;
  name: string;
  description?: string;
  version: string;
  type: string[];
  enabled: boolean;
  manifest?: PluginManifest;
  metadata?: PluginSDKMetadata;
  configuration?: Record<string, unknown>;
  configMetadata?: Record<string, ConfigFieldMetadata>;
  instanceId?: string;
  auth?: unknown;
  oauthAvailable?: boolean;
  oauthConfigured?: boolean;
  oauthConnected?: boolean;
  pluginPath?: string;
}

/**
 * Plugin manifest structure
 */
export interface PluginManifest {
  id: string;
  name: string;
  description?: string;
  version: string;
  configSchema?: Record<string, ConfigFieldSchema>;
  authMethods?: AuthMethod[];
  capabilities?: PluginCapabilities;
  settingsExtensions?: SettingsExtension[];
  ui?: {
    configuration?: string;
  };
}

/**
 * Plugin SDK V2 metadata
 */
export interface PluginSDKMetadata {
  configSchema?: Record<string, ConfigFieldSchema>;
  authMethods?: AuthMethod[];
  pages?: PluginPage[];
}

/**
 * Plugin page descriptor (SDK V2)
 */
export interface PluginPage {
  id: string;
  title: string;
  component: string;
  slot?: "standalone" | "after-settings" | "before-settings";
  icon?: string;
  requiresSetup?: boolean;
}

/**
 * Config field schema
 */
export interface ConfigFieldSchema {
  type: "string" | "number" | "boolean" | "select" | "textarea" | "json";
  label?: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  encrypted?: boolean;
  env?: string;
  default?: string | number | boolean;
  options?: Array<{ value: string | number; label: string }>;
}

/**
 * Config field metadata (source tracking)
 */
export interface ConfigFieldMetadata {
  source: "env" | "database" | "default";
  canOverride: boolean;
  isEncrypted: boolean;
  hasEnvFallback?: boolean;
}

/**
 * Auth method descriptor
 */
export interface AuthMethod {
  id: string;
  type: "apiKey" | "oauth2" | "basic";
  label: string;
  configField?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
}

/**
 * Plugin capabilities
 */
export interface PluginCapabilities {
  chat_connector?: {
    features?: {
      send_message?: boolean;
      receive_message?: boolean;
      list_conversations?: boolean;
    };
  };
  mcp?:
    | boolean
    | {
        tools?: Array<{
          name: string;
          label?: string;
          description?: string;
        }>;
      };
  document_importer?: boolean;
  [key: string]: unknown;
}

/**
 * Settings extension descriptor (legacy)
 */
export interface SettingsExtension {
  slot: "before-settings" | "after-settings" | "tab";
  component?: string;
  template?: string;
  tabName?: string;
  tabOrder?: number;
  props?: Record<string, unknown>;
}

/**
 * Plugin extension (internal representation)
 */
export interface PluginExtension {
  id: string;
  component?: unknown; // Vue component (markRaw)
  componentName?: string; // For SDK V2 dynamic loading
  title?: string;
  props?: Record<string, unknown>;
  isSDKV2?: boolean;
}

/**
 * Plugin tab extension
 */
export interface PluginTabExtension {
  id: string;
  component: unknown; // Vue component (markRaw)
  name: string;
  order?: number;
}
