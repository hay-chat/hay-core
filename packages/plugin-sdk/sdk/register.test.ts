import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRegisterAPI } from './register.js';
import { PluginRegistry } from './registry.js';
import type { HayLogger } from '../types/index.js';

describe('Register API', () => {
  let registry: PluginRegistry;
  let logger: HayLogger;
  let registerAPI: ReturnType<typeof createRegisterAPI>;

  beforeEach(() => {
    registry = new PluginRegistry();
    logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    registerAPI = createRegisterAPI({
      registry,
      manifest: { env: ['ALLOWED_VAR'] },
      logger,
    });
  });

  describe('Config Registration', () => {
    it('should register valid config schema', () => {
      registerAPI.config({
        apiKey: {
          type: 'string',
          label: 'API Key',
          required: true,
          secret: true,
        },
      });

      expect(registry.hasConfigField('apiKey')).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        'Registered config schema',
        { fields: 1 },
      );
    });

    it('should register multiple config fields', () => {
      registerAPI.config({
        field1: { type: 'string', label: 'Field 1' },
        field2: { type: 'number', label: 'Field 2' },
        field3: { type: 'boolean', label: 'Field 3' },
      });

      expect(registry.hasConfigField('field1')).toBe(true);
      expect(registry.hasConfigField('field2')).toBe(true);
      expect(registry.hasConfigField('field3')).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        'Registered config schema',
        { fields: 3 },
      );
    });

    it('should validate config schema type', () => {
      expect(() => {
        registerAPI.config(null as any);
      }).toThrow('Config schema must be an object');
    });

    it('should validate field types', () => {
      expect(() => {
        registerAPI.config({
          badField: { type: 'invalid-type' as any, label: 'Bad Field' },
        });
      }).toThrow('has invalid type: invalid-type');
    });

    it('should validate env var is in manifest allowlist', () => {
      expect(() => {
        registerAPI.config({
          apiKey: {
            type: 'string',
            label: 'API Key',
            env: 'DISALLOWED_VAR',
          },
        });
      }).toThrow('not in manifest allowlist');
    });

    it('should allow env vars in manifest allowlist', () => {
      expect(() => {
        registerAPI.config({
          apiKey: {
            type: 'string',
            label: 'API Key',
            env: 'ALLOWED_VAR',
          },
        });
      }).not.toThrow();
    });

    it('should validate default value type matches field type', () => {
      expect(() => {
        registerAPI.config({
          port: {
            type: 'number',
            label: 'Port',
            default: 'not-a-number' as any,
          },
        });
      }).toThrow('default value has wrong type');
    });

    it('should accept valid default values', () => {
      expect(() => {
        registerAPI.config({
          name: { type: 'string', label: 'Name', default: 'default-name' },
          port: { type: 'number', label: 'Port', default: 3000 },
          enabled: { type: 'boolean', label: 'Enabled', default: true },
          options: { type: 'json', label: 'Options', default: { key: 'value' } },
        });
      }).not.toThrow();
    });
  });

  describe('Route Registration', () => {
    it('should register valid route', () => {
      const handler = async (req: any, res: any) => {
        res.json({ ok: true });
      };

      registerAPI.route('POST', '/webhook', handler);

      const routes = registry.getRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].method).toBe('POST');
      expect(routes[0].path).toBe('/webhook');
      expect(routes[0].handler).toBe(handler);
      expect(logger.debug).toHaveBeenCalledWith('Registered route', {
        method: 'POST',
        path: '/webhook',
      });
    });

    it('should validate HTTP method', () => {
      expect(() => {
        registerAPI.route('INVALID' as any, '/path', async () => {});
      }).toThrow('Invalid HTTP method');
    });

    it('should accept all valid HTTP methods', () => {
      const handler = async () => {};

      expect(() => {
        registerAPI.route('GET', '/get', handler);
        registerAPI.route('POST', '/post', handler);
        registerAPI.route('PUT', '/put', handler);
        registerAPI.route('PATCH', '/patch', handler);
        registerAPI.route('DELETE', '/delete', handler);
      }).not.toThrow();

      expect(registry.getRoutes()).toHaveLength(5);
    });

    it('should validate route path starts with slash', () => {
      expect(() => {
        registerAPI.route('GET', 'no-slash', async () => {});
      }).toThrow('Route path must start with "/"');
    });

    it('should validate route path is non-empty', () => {
      expect(() => {
        registerAPI.route('GET', '', async () => {});
      }).toThrow('Route path must be a non-empty string');
    });

    it('should validate handler is a function', () => {
      expect(() => {
        registerAPI.route('GET', '/path', 'not-a-function' as any);
      }).toThrow('Route handler must be a function');
    });
  });

  describe('API Key Auth Registration', () => {
    beforeEach(() => {
      // Register config field first
      registerAPI.config({
        apiKey: {
          type: 'string',
          label: 'API Key',
          required: true,
          secret: true,
        },
      });
    });

    it('should register valid API key auth', () => {
      registerAPI.auth.apiKey({
        type: 'apiKey',
        id: 'api-key',
        label: 'API Key',
        configField: 'apiKey',
      });

      const methods = registry.getAuthMethods();
      expect(methods).toHaveLength(1);
      expect(methods[0].id).toBe('api-key');
      expect(methods[0].type).toBe('apiKey');
      expect(logger.debug).toHaveBeenCalledWith('Registered API key auth method', {
        id: 'api-key',
      });
    });

    it('should validate id is present', () => {
      expect(() => {
        registerAPI.auth.apiKey({
          type: 'apiKey',
          id: '',
          label: 'API Key',
          configField: 'apiKey',
        });
      }).toThrow('API key auth id must be a non-empty string');
    });

    it('should validate label is present', () => {
      expect(() => {
        registerAPI.auth.apiKey({
          type: 'apiKey',
          id: 'api-key',
          label: '',
          configField: 'apiKey',
        });
      }).toThrow('API key auth label must be a non-empty string');
    });

    it('should validate configField is present', () => {
      expect(() => {
        registerAPI.auth.apiKey({
          type: 'apiKey',
          id: 'api-key',
          label: 'API Key',
          configField: '',
        });
      }).toThrow('API key auth configField must be a non-empty string');
    });

    it('should validate config field exists', () => {
      expect(() => {
        registerAPI.auth.apiKey({
          type: 'apiKey',
          id: 'api-key',
          label: 'API Key',
          configField: 'unknownField',
        });
      }).toThrow('config field "unknownField" which hasn\'t been registered');
    });
  });

  describe('OAuth2 Auth Registration', () => {
    beforeEach(() => {
      // Register config fields first
      registerAPI.config({
        clientId: { type: 'string', label: 'Client ID', secret: true },
        clientSecret: { type: 'string', label: 'Client Secret', secret: true },
      });
    });

    it('should register valid OAuth2 auth', () => {
      registerAPI.auth.oauth2({
        type: 'oauth2',
        id: 'oauth',
        label: 'OAuth Login',
        authorizationUrl: 'https://example.com/oauth/authorize',
        tokenUrl: 'https://example.com/oauth/token',
        clientId: { name: 'clientId' },
        clientSecret: { name: 'clientSecret' },
        scopes: ['read', 'write'],
      });

      const methods = registry.getAuthMethods();
      expect(methods).toHaveLength(1);
      expect(methods[0].id).toBe('oauth');
      expect(methods[0].type).toBe('oauth2');
      expect(logger.debug).toHaveBeenCalledWith('Registered OAuth2 auth method', {
        id: 'oauth',
      });
    });

    it('should validate id is present', () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: 'oauth2',
          id: '',
          label: 'OAuth',
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: 'https://example.com/oauth/token',
          clientId: { name: 'clientId' },
          clientSecret: { name: 'clientSecret' },
        });
      }).toThrow('OAuth2 auth id must be a non-empty string');
    });

    it('should validate label is present', () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: 'oauth2',
          id: 'oauth',
          label: '',
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: 'https://example.com/oauth/token',
          clientId: { name: 'clientId' },
          clientSecret: { name: 'clientSecret' },
        });
      }).toThrow('OAuth2 auth label must be a non-empty string');
    });

    it('should validate authorizationUrl is present', () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: 'oauth2',
          id: 'oauth',
          label: 'OAuth',
          authorizationUrl: '',
          tokenUrl: 'https://example.com/oauth/token',
          clientId: { name: 'clientId' },
          clientSecret: { name: 'clientSecret' },
        });
      }).toThrow('OAuth2 auth authorizationUrl must be a non-empty string');
    });

    it('should validate tokenUrl is present', () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: 'oauth2',
          id: 'oauth',
          label: 'OAuth',
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: '',
          clientId: { name: 'clientId' },
          clientSecret: { name: 'clientSecret' },
        });
      }).toThrow('OAuth2 auth tokenUrl must be a non-empty string');
    });

    it('should validate clientId config field exists', () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: 'oauth2',
          id: 'oauth',
          label: 'OAuth',
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: 'https://example.com/oauth/token',
          clientId: { name: 'unknownField' },
          clientSecret: { name: 'clientSecret' },
        });
      }).toThrow('clientId references config field "unknownField" which hasn\'t been registered');
    });

    it('should validate clientSecret config field exists', () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: 'oauth2',
          id: 'oauth',
          label: 'OAuth',
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: 'https://example.com/oauth/token',
          clientId: { name: 'clientId' },
          clientSecret: { name: 'unknownField' },
        });
      }).toThrow('clientSecret references config field "unknownField" which hasn\'t been registered');
    });

    it('should validate scopes is an array', () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: 'oauth2',
          id: 'oauth',
          label: 'OAuth',
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: 'https://example.com/oauth/token',
          clientId: { name: 'clientId' },
          clientSecret: { name: 'clientSecret' },
          scopes: 'not-an-array' as any,
        });
      }).toThrow('OAuth2 auth scopes must be an array');
    });

    it('should validate scopes contains only strings', () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: 'oauth2',
          id: 'oauth',
          label: 'OAuth',
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: 'https://example.com/oauth/token',
          clientId: { name: 'clientId' },
          clientSecret: { name: 'clientSecret' },
          scopes: ['read', 123 as any, 'write'],
        });
      }).toThrow('OAuth2 auth scopes must be an array of strings');
    });

    it('should allow optional scopes', () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: 'oauth2',
          id: 'oauth',
          label: 'OAuth',
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: 'https://example.com/oauth/token',
          clientId: { name: 'clientId' },
          clientSecret: { name: 'clientSecret' },
        });
      }).not.toThrow();
    });
  });

  describe('UI Extension Registration', () => {
    it('should register valid UI extension', () => {
      registerAPI.ui({
        slot: 'plugin-settings',
        component: 'SettingsPanel.vue',
      });

      const extensions = registry.getUIExtensions();
      expect(extensions).toHaveLength(1);
      expect(extensions[0].slot).toBe('plugin-settings');
      expect(extensions[0].component).toBe('SettingsPanel.vue');
      expect(logger.debug).toHaveBeenCalledWith('Registered UI extension', {
        slot: 'plugin-settings',
      });
    });

    it('should validate slot is present', () => {
      expect(() => {
        registerAPI.ui({
          slot: '',
          component: 'Component.vue',
        });
      }).toThrow('UI extension slot must be a non-empty string');
    });

    it('should validate component is present', () => {
      expect(() => {
        registerAPI.ui({
          slot: 'plugin-settings',
          component: '',
        });
      }).toThrow('UI extension component must be a non-empty string');
    });

    it('should allow UI extension with props', () => {
      registerAPI.ui({
        slot: 'plugin-settings',
        component: 'SettingsPanel.vue',
        props: { theme: 'dark', size: 'large' },
      });

      const extensions = registry.getUIExtensions();
      expect(extensions[0].props).toEqual({ theme: 'dark', size: 'large' });
    });
  });

  describe('Integration Tests', () => {
    it('should enforce registration order (config before auth)', () => {
      // Try to register auth before config
      expect(() => {
        registerAPI.auth.apiKey({
          type: 'apiKey',
          id: 'api-key',
          label: 'API Key',
          configField: 'apiKey',
        });
      }).toThrow('config field "apiKey" which hasn\'t been registered');

      // Now register config
      registerAPI.config({
        apiKey: { type: 'string', label: 'API Key' },
      });

      // Now auth should work
      expect(() => {
        registerAPI.auth.apiKey({
          type: 'apiKey',
          id: 'api-key',
          label: 'API Key',
          configField: 'apiKey',
        });
      }).not.toThrow();
    });

    it('should allow multiple registrations of different types', () => {
      // Config
      registerAPI.config({
        apiKey: { type: 'string', label: 'API Key' },
      });

      // Auth
      registerAPI.auth.apiKey({
        type: 'apiKey',
        id: 'api-key',
        label: 'API Key',
        configField: 'apiKey',
      });

      // Route
      registerAPI.route('POST', '/webhook', async () => {});

      // UI
      registerAPI.ui({
        slot: 'plugin-settings',
        component: 'Settings.vue',
      });

      // Verify all registered
      expect(registry.hasConfigField('apiKey')).toBe(true);
      expect(registry.getAuthMethods()).toHaveLength(1);
      expect(registry.getRoutes()).toHaveLength(1);
      expect(registry.getUIExtensions()).toHaveLength(1);
    });
  });
});
