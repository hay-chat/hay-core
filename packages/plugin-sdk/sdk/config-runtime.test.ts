import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createConfigRuntimeAPI } from './config-runtime.js';
import { PluginRegistry } from './registry.js';
import type { HayLogger } from '../types/index.js';

describe('Config Runtime API', () => {
  let registry: PluginRegistry;
  let logger: HayLogger;

  beforeEach(() => {
    registry = new PluginRegistry();
    logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  describe('Resolution Pipeline', () => {
    it('should prioritize org config over env vars and defaults', () => {
      // Register config field with env and default
      registry.registerConfig({
        apiKey: {
          type: 'string',
          label: 'API Key',
          env: 'TEST_API_KEY',
          default: 'default-key',
        },
      });

      // Set env var
      process.env.TEST_API_KEY = 'env-key';

      // Create API with org config
      const api = createConfigRuntimeAPI({
        orgConfig: { apiKey: 'org-key' },
        registry,
        manifest: { env: ['TEST_API_KEY'] },
        logger,
      });

      // Should return org config value
      expect(api.get('apiKey')).toBe('org-key');

      // Cleanup
      delete process.env.TEST_API_KEY;
    });

    it('should fall back to env var when org config is not set', () => {
      registry.registerConfig({
        apiKey: {
          type: 'string',
          label: 'API Key',
          env: 'TEST_API_KEY',
        },
      });

      process.env.TEST_API_KEY = 'env-key';

      const api = createConfigRuntimeAPI({
        orgConfig: {},
        registry,
        manifest: { env: ['TEST_API_KEY'] },
        logger,
      });

      expect(api.get('apiKey')).toBe('env-key');

      delete process.env.TEST_API_KEY;
    });

    it('should fall back to default when org config and env var are not set', () => {
      registry.registerConfig({
        apiKey: {
          type: 'string',
          label: 'API Key',
          default: 'default-key',
        },
      });

      const api = createConfigRuntimeAPI({
        orgConfig: {},
        registry,
        manifest: {},
        logger,
      });

      expect(api.get('apiKey')).toBe('default-key');
    });

    it('should return undefined for optional fields with no value', () => {
      registry.registerConfig({
        optionalField: {
          type: 'string',
          label: 'Optional Field',
        },
      });

      const api = createConfigRuntimeAPI({
        orgConfig: {},
        registry,
        manifest: {},
        logger,
      });

      expect(api.getOptional('optionalField')).toBeUndefined();
    });

    it('should throw error for required fields with no value', () => {
      registry.registerConfig({
        requiredField: {
          type: 'string',
          label: 'Required Field',
          required: true,
        },
      });

      const api = createConfigRuntimeAPI({
        orgConfig: {},
        registry,
        manifest: {},
        logger,
      });

      expect(() => api.get('requiredField')).toThrow(
        'Config field "requiredField" is required but not configured',
      );
    });
  });

  describe('Environment Variable Parsing', () => {
    it('should parse string env vars', () => {
      registry.registerConfig({
        name: {
          type: 'string',
          label: 'Name',
          env: 'TEST_NAME',
        },
      });

      process.env.TEST_NAME = 'test-value';

      const api = createConfigRuntimeAPI({
        orgConfig: {},
        registry,
        manifest: { env: ['TEST_NAME'] },
        logger,
      });

      expect(api.get('name')).toBe('test-value');

      delete process.env.TEST_NAME;
    });

    it('should parse number env vars', () => {
      registry.registerConfig({
        port: {
          type: 'number',
          label: 'Port',
          env: 'TEST_PORT',
        },
      });

      process.env.TEST_PORT = '3000';

      const api = createConfigRuntimeAPI({
        orgConfig: {},
        registry,
        manifest: { env: ['TEST_PORT'] },
        logger,
      });

      expect(api.get('port')).toBe(3000);

      delete process.env.TEST_PORT;
    });

    it('should handle invalid number env vars', () => {
      registry.registerConfig({
        port: {
          type: 'number',
          label: 'Port',
          env: 'TEST_PORT',
        },
      });

      process.env.TEST_PORT = 'not-a-number';

      const api = createConfigRuntimeAPI({
        orgConfig: {},
        registry,
        manifest: { env: ['TEST_PORT'] },
        logger,
      });

      expect(api.getOptional('port')).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('expects number but env var has non-numeric value'),
      );

      delete process.env.TEST_PORT;
    });

    it('should parse boolean env vars (true variants)', () => {
      registry.registerConfig({
        enabled: {
          type: 'boolean',
          label: 'Enabled',
          env: 'TEST_ENABLED',
        },
      });

      const trueValues = ['true', 'TRUE', '1', 'yes', 'YES'];

      for (const value of trueValues) {
        process.env.TEST_ENABLED = value;

        const api = createConfigRuntimeAPI({
          orgConfig: {},
          registry,
          manifest: { env: ['TEST_ENABLED'] },
          logger,
        });

        expect(api.get('enabled')).toBe(true);
      }

      delete process.env.TEST_ENABLED;
    });

    it('should parse boolean env vars (false variants)', () => {
      registry.registerConfig({
        enabled: {
          type: 'boolean',
          label: 'Enabled',
          env: 'TEST_ENABLED',
        },
      });

      const falseValues = ['false', 'FALSE', '0', 'no', 'NO', ''];

      for (const value of falseValues) {
        process.env.TEST_ENABLED = value;

        const api = createConfigRuntimeAPI({
          orgConfig: {},
          registry,
          manifest: { env: ['TEST_ENABLED'] },
          logger,
        });

        expect(api.get('enabled')).toBe(false);
      }

      delete process.env.TEST_ENABLED;
    });

    it('should parse JSON env vars', () => {
      registry.registerConfig({
        options: {
          type: 'json',
          label: 'Options',
          env: 'TEST_OPTIONS',
        },
      });

      process.env.TEST_OPTIONS = JSON.stringify({ key: 'value', count: 42 });

      const api = createConfigRuntimeAPI({
        orgConfig: {},
        registry,
        manifest: { env: ['TEST_OPTIONS'] },
        logger,
      });

      expect(api.get('options')).toEqual({ key: 'value', count: 42 });

      delete process.env.TEST_OPTIONS;
    });

    it('should handle invalid JSON env vars', () => {
      registry.registerConfig({
        options: {
          type: 'json',
          label: 'Options',
          env: 'TEST_OPTIONS',
        },
      });

      process.env.TEST_OPTIONS = 'not-valid-json';

      const api = createConfigRuntimeAPI({
        orgConfig: {},
        registry,
        manifest: { env: ['TEST_OPTIONS'] },
        logger,
      });

      expect(api.getOptional('options')).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('expects JSON but env var has invalid JSON'),
      );

      delete process.env.TEST_OPTIONS;
    });
  });

  describe('Environment Variable Security', () => {
    it('should warn when env var is not in manifest allowlist', () => {
      registry.registerConfig({
        apiKey: {
          type: 'string',
          label: 'API Key',
          env: 'UNSAFE_VAR',
        },
      });

      process.env.UNSAFE_VAR = 'value';

      const api = createConfigRuntimeAPI({
        orgConfig: {},
        registry,
        manifest: { env: ['SAFE_VAR'] }, // UNSAFE_VAR not in allowlist
        logger,
      });

      api.getOptional('apiKey');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not in manifest allowlist'),
      );

      delete process.env.UNSAFE_VAR;
    });

    it('should allow env vars in manifest allowlist', () => {
      registry.registerConfig({
        apiKey: {
          type: 'string',
          label: 'API Key',
          env: 'ALLOWED_VAR',
        },
      });

      process.env.ALLOWED_VAR = 'secret-value';

      const api = createConfigRuntimeAPI({
        orgConfig: {},
        registry,
        manifest: { env: ['ALLOWED_VAR'] },
        logger,
      });

      expect(api.get('apiKey')).toBe('secret-value');
      expect(logger.warn).not.toHaveBeenCalled();

      delete process.env.ALLOWED_VAR;
    });
  });

  describe('API Methods', () => {
    it('should return all registered config field names with keys()', () => {
      registry.registerConfig({
        field1: { type: 'string', label: 'Field 1' },
        field2: { type: 'number', label: 'Field 2' },
        field3: { type: 'boolean', label: 'Field 3' },
      });

      const api = createConfigRuntimeAPI({
        orgConfig: {},
        registry,
        manifest: {},
        logger,
      });

      const keys = api.keys();
      expect(keys).toContain('field1');
      expect(keys).toContain('field2');
      expect(keys).toContain('field3');
      expect(keys).toHaveLength(3);
    });

    it('should warn when accessing unregistered config field', () => {
      const api = createConfigRuntimeAPI({
        orgConfig: {},
        registry,
        manifest: {},
        logger,
      });

      const result = api.getOptional('unknownField');

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Config field "unknownField" is not registered in schema',
      );
    });

    it('should handle null org config values as missing', () => {
      registry.registerConfig({
        apiKey: {
          type: 'string',
          label: 'API Key',
          default: 'default-value',
        },
      });

      const api = createConfigRuntimeAPI({
        orgConfig: { apiKey: null },
        registry,
        manifest: {},
        logger,
      });

      // Null should be treated as missing, fall back to default
      expect(api.get('apiKey')).toBe('default-value');
    });

    it('should handle undefined org config values as missing', () => {
      registry.registerConfig({
        apiKey: {
          type: 'string',
          label: 'API Key',
          default: 'default-value',
        },
      });

      const api = createConfigRuntimeAPI({
        orgConfig: { apiKey: undefined },
        registry,
        manifest: {},
        logger,
      });

      // Undefined should be treated as missing, fall back to default
      expect(api.get('apiKey')).toBe('default-value');
    });

    it('should allow falsy org config values (empty string, 0, false)', () => {
      registry.registerConfig({
        name: {
          type: 'string',
          label: 'Name',
          default: 'default-name',
        },
        count: {
          type: 'number',
          label: 'Count',
          default: 10,
        },
        enabled: {
          type: 'boolean',
          label: 'Enabled',
          default: true,
        },
      });

      const api = createConfigRuntimeAPI({
        orgConfig: {
          name: '',
          count: 0,
          enabled: false,
        },
        registry,
        manifest: {},
        logger,
      });

      // Falsy values should NOT fall back to defaults
      expect(api.get('name')).toBe('');
      expect(api.get('count')).toBe(0);
      expect(api.get('enabled')).toBe(false);
    });
  });

  describe('Type Safety', () => {
    it('should allow type parameter for get()', () => {
      registry.registerConfig({
        port: {
          type: 'number',
          label: 'Port',
        },
      });

      const api = createConfigRuntimeAPI({
        orgConfig: { port: 3000 },
        registry,
        manifest: {},
        logger,
      });

      const port = api.get<number>('port');
      expect(port).toBe(3000);
    });

    it('should allow type parameter for getOptional()', () => {
      registry.registerConfig({
        options: {
          type: 'json',
          label: 'Options',
        },
      });

      const api = createConfigRuntimeAPI({
        orgConfig: { options: { key: 'value' } },
        registry,
        manifest: {},
        logger,
      });

      const options = api.getOptional<{ key: string }>('options');
      expect(options).toEqual({ key: 'value' });
    });
  });
});
