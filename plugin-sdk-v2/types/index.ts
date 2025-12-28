/**
 * Hay Plugin SDK v2 - Type Definitions
 *
 * This module contains all type definitions for the Hay Plugin SDK.
 * Types are defined locally and do not import from Hay Core.
 *
 * @module @hay/plugin-sdk-v2/types
 */

// ============================================================================
// Plugin Definition Types (Phase 2.1) ✅
// ============================================================================

export type { HayPluginDefinition, HayPluginFactory } from './plugin';

export type {
  OnInitializeHook,
  OnStartHook,
  OnValidateAuthHook,
  OnConfigUpdateHook,
  OnDisableHook,
  OnEnableHook,
} from './hooks';

// ============================================================================
// Context Types (Phase 2.2) ✅
// ============================================================================

export type {
  HayGlobalContext,
  HayStartContext,
  HayAuthValidationContext,
  HayConfigUpdateContext,
  HayDisableContext,
} from './contexts';

// ============================================================================
// Logger (Phase 2.2) ✅
// ============================================================================

export type { HayLogger } from './logger';

// ============================================================================
// Config System (Phase 2.2) ✅
// ============================================================================

export type {
  ConfigFieldType,
  ConfigFieldDescriptor,
  ConfigFieldReference,
  HayConfigDescriptorAPI,
  HayConfigRuntimeAPI,
} from './config';

// ============================================================================
// Auth System (Phase 2.2) ✅
// ============================================================================

export type {
  ApiKeyAuthOptions,
  OAuth2AuthOptions,
  RegisterAuthAPI,
  AuthState,
  HayAuthRuntimeAPI,
} from './auth';

// ============================================================================
// MCP System (Phase 2.2) ✅
// ============================================================================

export type {
  McpServerInstance,
  McpInitializerContext,
  ExternalMcpOptions,
  HayMcpRuntimeAPI,
} from './mcp';

// ============================================================================
// Routes (Phase 2.2) ✅
// ============================================================================

export type { HttpMethod, RouteHandler } from './route';

// ============================================================================
// UI Extensions (Phase 2.2) ✅
// ============================================================================

export type { UIExtensionDescriptor, PluginPage } from './ui';

// ============================================================================
// Register API (Phase 2.2) ✅
// ============================================================================

export type { HayRegisterAPI, UIRegistrationAPI } from './register';

// ============================================================================
// Organization (Phase 2.2) ✅
// ============================================================================

export type { HayOrg } from './org';

// ============================================================================
// Manifest Types (Phase 2.7) ✅
// ============================================================================

export type {
  HayPluginManifest,
  HayPluginPackageJson,
  PluginCategory,
  PluginCapability,
} from './manifest';
