/**
 * Hay Plugin SDK v2 - Type Definitions
 *
 * This module contains all type definitions for the Hay Plugin SDK.
 * Types are defined locally and do not import from Hay Core.
 *
 * @module @hay/plugin-sdk-v2/types
 */

// ============================================================================
// Plugin Definition Types (Phase 2.1)
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
// Context Types (Phase 2.2 - Forward Declarations Only)
// ============================================================================

export type {
  HayGlobalContext,
  HayStartContext,
  HayAuthValidationContext,
  HayConfigUpdateContext,
  HayDisableContext,
} from './contexts';

// ============================================================================
// Additional types to be exported in future phases:
// ============================================================================
// - Phase 2.2: Register API, Config Descriptor API, Logger
// - Phase 2.3: Config field types
// - Phase 2.4: Auth types
// - Phase 2.5: MCP types
// - Phase 2.6: UI and Route types
// - Phase 2.7: Manifest types
