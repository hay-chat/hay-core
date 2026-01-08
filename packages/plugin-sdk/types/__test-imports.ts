/**
 * Test file to verify all Phase 2.1 types can be imported correctly.
 * This file is not part of the build - it's just for validation.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import type {
  // Plugin definition types
  HayPluginFactory,
  HayPluginDefinition,

  // Hook types
  OnInitializeHook,
  OnStartHook,
  OnValidateAuthHook,
  OnConfigUpdateHook,
  OnDisableHook,
  OnEnableHook,

  // Context types (forward declarations)
  HayGlobalContext,
  HayStartContext,
  HayAuthValidationContext,
  HayConfigUpdateContext,
  HayDisableContext,
} from './index';

// Test that we can use these types
const testFactory: HayPluginFactory = (_ctx: HayGlobalContext) => ({
  name: 'Test Plugin',

  onInitialize: ((_ctx: HayGlobalContext) => {
    // Will have access to register, config, logger in Phase 2.2
  }) satisfies OnInitializeHook,

  onStart: ((_ctx: HayStartContext) => {
    // Will have access to org, config, auth, mcp, logger in Phase 2.2
  }) satisfies OnStartHook,

  onValidateAuth: ((_ctx: HayAuthValidationContext) => {
    return true;
  }) satisfies OnValidateAuthHook,

  onConfigUpdate: ((_ctx: HayConfigUpdateContext) => {
    // Optional hook
  }) satisfies OnConfigUpdateHook,

  onDisable: ((_ctx: HayDisableContext) => {
    // Cleanup
  }) satisfies OnDisableHook,

  // CORE-ONLY - not called by runner
  onEnable: ((_ctx: HayGlobalContext) => {
    // Reserved for core
  }) satisfies OnEnableHook,
});

// Verify definition matches interface
testFactory({} as HayGlobalContext) satisfies HayPluginDefinition;

// This file should compile without errors
export {};
