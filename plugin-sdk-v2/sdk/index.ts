/**
 * Hay Plugin SDK v2 - Main SDK Export
 *
 * This is the main entry point for the Hay Plugin SDK.
 * Plugin authors import from this module to build plugins.
 *
 * Example usage:
 * ```typescript
 * import { defineHayPlugin } from '@hay/plugin-sdk-v2';
 *
 * export default defineHayPlugin((ctx) => ({
 *   name: 'My Plugin',
 *   onInitialize() {
 *     // Register config, auth, routes, UI
 *   },
 *   async onStart(ctx) {
 *     // Start MCP servers, connect to services
 *   }
 * }));
 * ```
 *
 * @module @hay/plugin-sdk-v2
 */

// ============================================================================
// Core Factory (Phase 3.1) ✅
// ============================================================================

export { defineHayPlugin, PluginDefinitionError } from './factory.js';

// ============================================================================
// Logger (Phase 3.2) ✅
// ============================================================================

export { Logger, createLogger, type LoggerContext } from './logger.js';

// ============================================================================
// Re-export types for convenience
// ============================================================================

export type {
  // Plugin core
  HayPluginDefinition,
  HayPluginFactory,

  // Hooks
  OnInitializeHook,
  OnStartHook,
  OnValidateAuthHook,
  OnConfigUpdateHook,
  OnDisableHook,
  OnEnableHook,

  // Contexts
  HayGlobalContext,
  HayStartContext,
  HayAuthValidationContext,
  HayConfigUpdateContext,
  HayDisableContext,

  // Config
  ConfigFieldType,
  ConfigFieldDescriptor,
  ConfigFieldReference,
  HayConfigDescriptorAPI,
  HayConfigRuntimeAPI,

  // Auth
  ApiKeyAuthOptions,
  OAuth2AuthOptions,
  RegisterAuthAPI,
  AuthState,
  HayAuthRuntimeAPI,

  // MCP
  McpServerInstance,
  McpInitializerContext,
  ExternalMcpOptions,
  HayMcpRuntimeAPI,

  // Other
  HayLogger,
  HayOrg,
  HayRegisterAPI,
  UIExtensionDescriptor,
  HttpMethod,
  RouteHandler,
} from '../types/index.js';

// ============================================================================
// Future SDK exports (upcoming phases):
// ============================================================================
// - Phase 3.3: Register API implementation
// - Phase 3.4: Config descriptor API implementation
// - Phase 3.5: Runtime config API implementation
// - Phase 3.6: Runtime auth API implementation
// - Phase 3.7: MCP runtime API implementation
