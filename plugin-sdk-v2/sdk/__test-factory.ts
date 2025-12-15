/**
 * Test file to verify the factory function works correctly.
 * This file is not part of the build - it's just for validation.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { defineHayPlugin, PluginDefinitionError } from './factory.js';
import type { HayGlobalContext, HayPluginDefinition } from '../types/index.js';

// Test 1: Basic factory usage
const testPlugin = defineHayPlugin((_ctx: HayGlobalContext) => ({
  name: 'Test Plugin',

  onInitialize() {
    // Basic initialization
  },

  async onStart(ctx) {
    // Start logic
  },
}));

// Test 2: Factory with all hooks
const fullPlugin = defineHayPlugin((globalCtx) => ({
  name: 'Full Plugin',

  onInitialize() {
    const { register, config, logger } = globalCtx;
    logger.info('Initializing');
  },

  async onStart(ctx) {
    const { org, config, auth, mcp, logger } = ctx;
    logger.info(`Starting for org: ${org.id}`);
  },

  async onValidateAuth(ctx) {
    return true;
  },

  onConfigUpdate(ctx) {
    ctx.logger.info('Config updated');
  },

  onDisable(ctx) {
    ctx.logger.info('Disabled');
  },

  onEnable(ctx) {
    // CORE-ONLY hook
    ctx.logger.info('Enabled');
  },
}));

// Test 3: Factory returns correct type
const _testDef: HayPluginDefinition = testPlugin({} as HayGlobalContext);

// Test 4: Error handling - invalid factory (would throw at runtime)
// const invalidFactory1 = defineHayPlugin('not a function' as any);

// Test 5: Error handling - invalid definition (would throw at runtime)
// const invalidPlugin = defineHayPlugin(() => ({} as any));

// Test 6: Error handling - missing name (would throw at runtime)
// const noNamePlugin = defineHayPlugin(() => ({
//   onInitialize() {}
// } as any));

// Test 7: Error handling - invalid hook type (would throw at runtime)
// const invalidHook = defineHayPlugin(() => ({
//   name: 'Test',
//   onStart: 'not a function' as any,
// }));

// Test 8: Minimal valid plugin
const minimalPlugin = defineHayPlugin(() => ({
  name: 'Minimal',
}));

// Test 9: Plugin with only name and one hook
const simplePlugin = defineHayPlugin(() => ({
  name: 'Simple',
  async onStart(ctx) {
    ctx.logger.info('Started');
  },
}));

// Test 10: Factory uses globalCtx correctly
const contextAwarePlugin = defineHayPlugin((globalCtx) => {
  // Can use globalCtx in factory closure
  const { register, config, logger } = globalCtx;

  // Return definition that uses captured context
  return {
    name: 'Context Aware',

    onInitialize() {
      // Can access captured context
      logger.info('Using captured logger');
      register.config({
        test: {
          type: 'string',
        },
      });
    },
  };
});

// This file should compile without errors
export {};
