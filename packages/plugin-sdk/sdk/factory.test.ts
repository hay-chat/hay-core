import { describe, it, expect, vi } from 'vitest';
import { defineHayPlugin } from './factory.js';

describe('defineHayPlugin', () => {
  it('should accept a valid factory function', () => {
    const factory = defineHayPlugin((globalCtx) => ({
      async onInitialize() {
        globalCtx.logger.info('initialized');
      },
    }));

    expect(factory).toBeDefined();
    expect(typeof factory).toBe('function');
  });

  it('should reject non-function arguments', () => {
    expect(() => {
      defineHayPlugin({} as any);
    }).toThrow('defineHayPlugin: factory must be a function');
  });

  it('should allow factory with all optional hooks', () => {
    const factory = defineHayPlugin((globalCtx) => ({
      async onInitialize() {},
      async onStart(ctx) {},
      async onValidateAuth(ctx) {},
      async onConfigUpdate(ctx) {},
      async onDisable(ctx) {},
    }));

    expect(factory).toBeDefined();
    expect(typeof factory).toBe('function');
  });

  it('should work with minimal plugin (only onInitialize)', () => {
    const factory = defineHayPlugin((globalCtx) => ({
      async onInitialize() {
        globalCtx.logger.info('minimal plugin');
      },
    }));

    expect(factory).toBeDefined();
  });

  it('should capture global context in factory closure', () => {
    const logSpy = vi.fn();

    const factory = defineHayPlugin((globalCtx) => {
      // Capture global context in closure
      const { logger } = globalCtx;

      return {
        name: 'Test Plugin',
        async onInitialize() {
          logger.info('using captured context');
        },
        async onStart(ctx) {
          logger.info('still accessible in other hooks');
        },
      };
    });

    // Create mock global context
    const mockGlobalContext: any = {
      logger: {
        info: logSpy,
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      register: {
        config: vi.fn(),
        route: vi.fn(),
        ui: vi.fn(),
        auth: { apiKey: vi.fn(), oauth2: vi.fn() }
      },
      config: { field: vi.fn() },
    };

    // Call factory to get plugin definition
    const pluginDef = factory(mockGlobalContext);

    expect(pluginDef).toHaveProperty('onInitialize');
    expect(pluginDef).toHaveProperty('onStart');
  });

  it('should allow factory to return plugin with name', () => {
    const factory = defineHayPlugin((globalCtx) => ({
      name: 'Test Plugin',
      async onInitialize() {},
    }));

    const mockGlobalContext: any = {
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      register: {
        config: vi.fn(),
        route: vi.fn(),
        ui: vi.fn(),
        auth: { apiKey: vi.fn(), oauth2: vi.fn() }
      },
      config: { field: vi.fn() },
    };

    const pluginDef = factory(mockGlobalContext);
    expect(pluginDef).toHaveProperty('name', 'Test Plugin');
  });
});
