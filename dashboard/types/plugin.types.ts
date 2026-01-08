/**
 * Frontend type definitions for plugin components
 */

/**
 * Plugin display information for UI components
 */
export interface PluginDisplay {
  id: string;
  name: string;
  version?: string;
  metadata?: {
    authMethods?: Array<{
      id: string;
      type: string;
      label: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  manifest?: {
    [key: string]: unknown;
  };
}

/**
 * Plugin configuration object
 */
export interface PluginConfig extends Record<string, unknown> {
  instanceId?: string | null;
  organizationId?: string | null;
}
