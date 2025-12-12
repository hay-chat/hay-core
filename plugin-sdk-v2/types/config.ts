/**
 * Hay Plugin SDK v2 - Config System Types
 *
 * Types for plugin configuration system including descriptors and runtime APIs.
 *
 * @module @hay/plugin-sdk-v2/types/config
 */

/**
 * Config field type discriminator.
 *
 * Supported field types for plugin configuration.
 */
export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'json';

/**
 * Config field descriptor.
 *
 * Defines the schema for a single configuration field.
 * Used when registering config schema in `onInitialize`.
 *
 * @typeParam T - The TypeScript type of the field value
 *
 * @remarks
 * Fields can be:
 * - Required or optional (`required`)
 * - Mapped to environment variables (`env`)
 * - Marked as sensitive for UI masking (`sensitive`)
 * - Given default values (`default`)
 *
 * **Environment variable mapping**:
 * - If `env` is specified, it MUST be listed in the manifest's `hay-plugin.env` array
 * - The platform validates this at plugin load time
 * - At runtime, `config.get()` falls back to `process.env[env]` if org config is not set
 *
 * @example
 * ```typescript
 * register.config({
 *   apiKey: {
 *     type: 'string',
 *     required: false,
 *     env: 'SHOPIFY_API_KEY',
 *     sensitive: true,
 *     label: 'API Key',
 *     description: 'Your Shopify API key',
 *   },
 *   maxRetries: {
 *     type: 'number',
 *     default: 3,
 *     label: 'Max Retries',
 *   },
 * });
 * ```
 *
 * @see PLUGIN.md Section 5.2.2 (lines 386-409)
 * @see PLUGIN.md Section 7.1 (lines 663-698)
 */
export interface ConfigFieldDescriptor<T = any> {
  /**
   * Field type (string, number, boolean, json).
   */
  type: ConfigFieldType;

  /**
   * Human-readable label for UI.
   */
  label?: string;

  /**
   * Description text for UI.
   */
  description?: string;

  /**
   * Whether this field is required.
   *
   * @remarks
   * If required and not provided, the platform may show a configuration error in UI.
   *
   * @defaultValue false
   */
  required?: boolean;

  /**
   * Environment variable name for fallback.
   *
   * @remarks
   * **IMPORTANT**: Must be listed in manifest `hay-plugin.env` array.
   * The SDK will validate this at load time.
   *
   * At runtime, if org config is not set, `config.get()` returns `process.env[env]`.
   */
  env?: string;

  /**
   * Mark field as sensitive (password, token, etc.).
   *
   * @remarks
   * Sensitive fields are masked in UI and logs.
   *
   * @defaultValue false
   */
  sensitive?: boolean;

  /**
   * Default value if not configured.
   */
  default?: T;
}

/**
 * Config field reference.
 *
 * A reference to a config field by name, used in declarative contexts
 * (e.g., OAuth2 options that reference client ID/secret fields).
 *
 * @remarks
 * This is NOT a resolved value - it's a reference to be resolved at runtime.
 * Created via `config.field(name)` in `onInitialize`.
 *
 * @example
 * ```typescript
 * const clientIdRef = config.field('clientId');
 * const clientSecretRef = config.field('clientSecret');
 *
 * register.auth.oauth2({
 *   id: 'oauth',
 *   label: 'OAuth 2.0',
 *   authorizationUrl: 'https://...',
 *   tokenUrl: 'https://...',
 *   clientId: clientIdRef,
 *   clientSecret: clientSecretRef,
 * });
 * ```
 *
 * @see PLUGIN.md Section 5.2.2 (lines 386-409)
 */
export interface ConfigFieldReference {
  /**
   * Name of the referenced config field.
   */
  name: string;
}

/**
 * Config descriptor API for global context.
 *
 * Used in `onInitialize` to create field references for declarative registration
 * (e.g., referencing config fields in auth options).
 *
 * @remarks
 * **IMPORTANT**: This API is ONLY for creating field references, NOT for reading values.
 * To read config values, use `HayConfigRuntimeAPI.get()` in org runtime hooks.
 *
 * **Constraint**: Only available in `HayGlobalContext` (onInitialize).
 *
 * @see {@link HayConfigRuntimeAPI}
 * @see PLUGIN.md Section 5.2.2 (lines 386-409)
 */
export interface HayConfigDescriptorAPI {
  /**
   * Create a reference to a config field.
   *
   * Returns a reference object that can be used in declarative contexts
   * (e.g., OAuth2 options). Does NOT resolve the value.
   *
   * @param name - Name of the config field
   * @returns Config field reference
   *
   * @example
   * ```typescript
   * const apiKeyRef = config.field('apiKey');
   * register.auth.apiKey({
   *   id: 'apiKey',
   *   label: 'API Key',
   *   configField: 'apiKey', // Note: some APIs take string directly
   * });
   * ```
   */
  field(name: string): ConfigFieldReference;
}

/**
 * Config runtime API for org runtime context.
 *
 * Used in org runtime hooks (`onStart`, `onValidateAuth`, etc.) to read
 * configuration values for the current organization.
 *
 * @remarks
 * **Resolution pipeline** for `config.get(key)`:
 * 1. Look up org-specific stored setting for the field
 * 2. If undefined and field has `env` (in manifest allowlist), return `process.env[env]`
 * 3. If still undefined:
 *    - If field is required: platform may show config error in UI
 *    - Otherwise: return `undefined` or throw (implementation-dependent)
 *
 * **Constraint**: Only available in org runtime contexts (onStart, onValidateAuth, etc.).
 * NOT available in `onInitialize` (use `HayConfigDescriptorAPI` there).
 *
 * @see {@link HayConfigDescriptorAPI}
 * @see PLUGIN.md Section 5.3.2 (lines 475-503)
 * @see PLUGIN.md Section 7.2 (lines 690-698)
 */
export interface HayConfigRuntimeAPI {
  /**
   * Get a config value for the current organization.
   *
   * Resolves value using org config → env var fallback pipeline.
   *
   * @typeParam T - Expected type of the config value
   * @param key - Config field name
   * @returns Resolved config value
   *
   * @throws May throw if field is required but not configured (implementation-dependent)
   *
   * @example
   * ```typescript
   * const apiKey = ctx.config.get<string>('apiKey');
   * const maxRetries = ctx.config.get<number>('maxRetries');
   * ```
   */
  get<T = any>(key: string): T;

  /**
   * Get an optional config value for the current organization.
   *
   * Same as `get()` but returns `undefined` if not configured instead of throwing.
   *
   * @typeParam T - Expected type of the config value
   * @param key - Config field name
   * @returns Resolved config value or undefined
   *
   * @example
   * ```typescript
   * const webhookUrl = ctx.config.getOptional<string>('webhookUrl');
   * if (webhookUrl) {
   *   // Use webhook
   * }
   * ```
   */
  getOptional<T = any>(key: string): T | undefined;

  /**
   * Get all config field names.
   *
   * Returns array of all registered config field names.
   *
   * @returns Array of field names
   *
   * @example
   * ```typescript
   * const fields = ctx.config.keys();
   * logger.debug('Config fields', { fields });
   * ```
   */
  keys(): string[];
}
