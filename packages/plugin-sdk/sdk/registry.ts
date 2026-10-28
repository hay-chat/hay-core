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
  PluginPage,
  CronJobOptions,
  CronJobDescriptor,
  WebhookRoutingDescriptor,
  WebchatContributionOptions,
  WebchatContributionDescriptor,
  WebchatGateEvent,
  WebchatGateHandler,
  WebchatGateDescriptor,
  WebchatMetadata,
} from "../types/index.js";

/**
 * Registered webchat gate (descriptor + handler).
 *
 * @internal
 */
export interface RegisteredWebchatGate extends WebchatGateDescriptor {
  handler: WebchatGateHandler;
}

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
   * Registered UI pages.
   * Array of plugin page descriptors.
   */
  private uiPages: PluginPage[] = [];

  /**
   * Registered cron jobs.
   * Array of cron job options (includes handler functions).
   */
  private cronJobs: CronJobOptions[] = [];

  /**
   * Declared webhook routing strategy (shared-app fan-out), or undefined.
   */
  private webhookRouting: WebhookRoutingDescriptor | undefined;

  /** Declared webchat contributions. */
  private webchatContributions: WebchatContributionOptions[] = [];

  /** Registered webchat gates (one per event). */
  private webchatGates: RegisteredWebchatGate[] = [];

  /**
   * Register a webchat contribution.
   *
   * @param contribution - Contribution options
   */
  registerWebchatContribution(contribution: WebchatContributionOptions): void {
    if (this.webchatContributions.some((c) => c.id === contribution.id)) {
      throw new Error(`Webchat contribution with id "${contribution.id}" is already registered`);
    }
    this.webchatContributions.push(contribution);
  }

  /**
   * Register a webchat gate.
   *
   * @param gate - Gate descriptor + handler
   */
  registerWebchatGate(gate: RegisteredWebchatGate): void {
    if (this.webchatGates.some((g) => g.event === gate.event)) {
      throw new Error(`Webchat gate for "${gate.event}" is already registered`);
    }
    this.webchatGates.push(gate);
  }

  /**
   * Get the registered gate (with handler) for an event.
   *
   * @param event - Gate event
   */
  getWebchatGate(event: WebchatGateEvent): RegisteredWebchatGate | undefined {
    return this.webchatGates.find((g) => g.event === event);
  }

  /**
   * Get the serialisable webchat metadata for the `/metadata` endpoint.
   * Config-field references are split out into `configProps`.
   */
  getWebchatMetadata(): WebchatMetadata {
    const contributions: WebchatContributionDescriptor[] = this.webchatContributions.map(
      ({ id, type, props }) => {
        const literalProps: Record<string, string | number | boolean> = {};
        const configProps: Record<string, string> = {};
        for (const [key, value] of Object.entries(props)) {
          if (typeof value === "object" && value !== null) {
            configProps[key] = value.name;
          } else {
            literalProps[key] = value;
          }
        }
        return { id, type, props: literalProps, configProps };
      },
    );
    const gates = this.webchatGates.map(({ event, timeoutMs, failurePolicy }) => ({
      event,
      timeoutMs,
      failurePolicy,
    }));
    return { contributions, gates };
  }

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
   * Register a UI page.
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
   * Register a cron job.
   *
   * @param job - Cron job options
   */
  registerCronJob(job: CronJobOptions): void {
    const existing = this.cronJobs.find((c) => c.name === job.name);
    if (existing) {
      throw new Error(`Cron job with name "${job.name}" is already registered`);
    }

    this.cronJobs.push(job);
  }

  /**
   * Get a registered cron job (with handler) by name.
   *
   * @param name - Cron job name
   * @returns Cron job options or undefined
   */
  getCronJob(name: string): CronJobOptions | undefined {
    return this.cronJobs.find((c) => c.name === name);
  }

  /**
   * Register the webhook routing strategy (shared-app fan-out).
   *
   * @param descriptor - Webhook routing descriptor
   */
  registerWebhookRouting(descriptor: WebhookRoutingDescriptor): void {
    if (this.webhookRouting) {
      throw new Error("Webhook routing strategy is already registered");
    }

    this.webhookRouting = descriptor;
  }

  /**
   * Get the declared webhook routing strategy for the `/metadata` endpoint.
   *
   * @returns Webhook routing descriptor or undefined
   */
  getWebhookRouting(): WebhookRoutingDescriptor | undefined {
    return this.webhookRouting;
  }

  /**
   * Get serialisable cron descriptors (no handlers) for the `/metadata` endpoint.
   *
   * @returns Array of cron descriptors
   */
  getCronJobDescriptors(): CronJobDescriptor[] {
    return this.cronJobs.map(({ name, schedule, retryPolicy }) => ({
      name,
      schedule,
      ...(retryPolicy ? { retryPolicy } : {}),
    }));
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
   * Get registered UI pages.
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
