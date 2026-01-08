/**
 * Hay Plugin SDK - Plugin Registry
 *
 * Internal registry for storing plugin registrations (config, auth, routes, UI).
 *
 * @module @hay/plugin-sdk/sdk/registry
 * @internal
 */

import type {
  ConfigFieldDescriptor,
  ApiKeyAuthOptions,
  OAuth2AuthOptions,
  HttpMethod,
  RouteHandler,
  UIExtensionDescriptor,
  PluginPage,
} from "../types/index.js";

/**
 * Registered route definition.
 *
 * @internal
 */
export interface RegisteredRoute {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
}

/**
 * Registered auth method.
 *
 * @internal
 */
export type RegisteredAuthMethod = ApiKeyAuthOptions | OAuth2AuthOptions;

/**
 * Plugin registry for storing all registrations.
 *
 * This is the internal state that tracks everything a plugin registers
 * during `onInitialize`. It's used to:
 * - Validate registrations
 * - Generate the `/metadata` endpoint response
 * - Set up routes in the HTTP server
 *
 * @remarks
 * One registry instance per plugin instance (per org).
 *
 * @internal
 */
export class PluginRegistry {
  /**
   * Registered config schema.
   * Map of field name to field descriptor.
   */
  private configSchema: Record<string, ConfigFieldDescriptor> = {};

  /**
   * Registered auth methods.
   * Array of auth method configurations.
   */
  private authMethods: RegisteredAuthMethod[] = [];

  /**
   * Registered HTTP routes.
   * Array of route definitions.
   */
  private routes: RegisteredRoute[] = [];

  /**
   * Registered UI extensions.
   * Array of UI extension descriptors.
   */
  private uiExtensions: UIExtensionDescriptor[] = [];

  /**
   * Registered UI pages (SDK V2 enhanced system).
   * Array of plugin page descriptors.
   */
  private uiPages: PluginPage[] = [];

  /**
   * Register config schema.
   *
   * @param schema - Config field descriptors
   */
  registerConfig(schema: Record<string, ConfigFieldDescriptor>): void {
    // Merge with existing schema (allow multiple calls)
    this.configSchema = {
      ...this.configSchema,
      ...schema,
    };
  }

  /**
   * Register an auth method.
   *
   * @param method - Auth method configuration
   */
  registerAuthMethod(method: RegisteredAuthMethod): void {
    // Check for duplicate auth method IDs
    const existing = this.authMethods.find((m) => m.id === method.id);
    if (existing) {
      throw new Error(`Auth method with id "${method.id}" is already registered`);
    }

    this.authMethods.push(method);
  }

  /**
   * Register an HTTP route.
   *
   * @param route - Route definition
   */
  registerRoute(route: RegisteredRoute): void {
    // Check for duplicate routes (same method + path)
    const existing = this.routes.find((r) => r.method === route.method && r.path === route.path);
    if (existing) {
      throw new Error(`Route ${route.method} ${route.path} is already registered`);
    }

    this.routes.push(route);
  }

  /**
   * Register a UI extension (legacy).
   *
   * @param extension - UI extension descriptor
   */
  registerUIExtension(extension: UIExtensionDescriptor): void {
    this.uiExtensions.push(extension);
  }

  /**
   * Register a UI page (SDK V2 enhanced system).
   *
   * @param page - Plugin page descriptor
   */
  registerUIPage(page: PluginPage): void {
    // Check for duplicate page IDs
    const existing = this.uiPages.find((p) => p.id === page.id);
    if (existing) {
      throw new Error(`UI page with id "${page.id}" is already registered`);
    }

    this.uiPages.push(page);
  }

  /**
   * Get registered config schema.
   *
   * @returns Config schema
   */
  getConfigSchema(): Record<string, ConfigFieldDescriptor> {
    return { ...this.configSchema };
  }

  /**
   * Get registered auth methods.
   *
   * @returns Array of auth method configurations
   */
  getAuthMethods(): RegisteredAuthMethod[] {
    return [...this.authMethods];
  }

  /**
   * Get registered routes.
   *
   * @returns Array of route definitions
   */
  getRoutes(): RegisteredRoute[] {
    return [...this.routes];
  }

  /**
   * Get registered UI extensions (legacy).
   *
   * @returns Array of UI extension descriptors
   */
  getUIExtensions(): UIExtensionDescriptor[] {
    return [...this.uiExtensions];
  }

  /**
   * Get registered UI pages (SDK V2 enhanced system).
   *
   * @returns Array of plugin page descriptors
   */
  getUIPages(): PluginPage[] {
    return [...this.uiPages];
  }

  /**
   * Check if a config field exists.
   *
   * @param fieldName - Field name to check
   * @returns True if field exists
   */
  hasConfigField(fieldName: string): boolean {
    return fieldName in this.configSchema;
  }

  /**
   * Get a config field descriptor.
   *
   * @param fieldName - Field name
   * @returns Field descriptor or undefined
   */
  getConfigField(fieldName: string): ConfigFieldDescriptor | undefined {
    return this.configSchema[fieldName];
  }
}
