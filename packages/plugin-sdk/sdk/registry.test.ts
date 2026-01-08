import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from './registry.js';
import { ConfigFieldDescriptor } from '../types/config.js';

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe('Config Schema Registration', () => {
    it('should register config schema', () => {
      const schema: Record<string, ConfigFieldDescriptor> = {
        apiKey: {
          type: 'string',
          label: 'API Key',
          required: true,
          secret: true,
        },
      };

      registry.registerConfig(schema);

      expect(registry.hasConfigField('apiKey')).toBe(true);
      expect(registry.getConfigField('apiKey')).toEqual(schema.apiKey);
    });

    it('should merge multiple config registrations', () => {
      registry.registerConfig({
        field1: { type: 'string', label: 'Field 1' },
      });

      registry.registerConfig({
        field2: { type: 'number', label: 'Field 2' },
      });

      expect(registry.hasConfigField('field1')).toBe(true);
      expect(registry.hasConfigField('field2')).toBe(true);
    });

    it('should overwrite config fields with same name', () => {
      registry.registerConfig({
        field1: { type: 'string', label: 'Original' },
      });

      registry.registerConfig({
        field1: { type: 'number', label: 'Updated' },
      });

      const field = registry.getConfigField('field1');
      expect(field?.label).toBe('Updated');
      expect(field?.type).toBe('number');
    });

    it('should return undefined for unknown config fields', () => {
      expect(registry.hasConfigField('unknown')).toBe(false);
      expect(registry.getConfigField('unknown')).toBeUndefined();
    });
  });

  describe('Auth Method Registration', () => {
    it('should register API Key auth method', () => {
      registry.registerAuthMethod({
        type: 'apiKey',
        id: 'api-key',
        label: 'API Key',
        fields: {
          apiKey: {
            type: 'string',
            label: 'API Key',
            required: true,
            secret: true,
          },
        },
      });

      const methods = registry.getAuthMethods();
      expect(methods).toHaveLength(1);
      expect(methods[0].id).toBe('api-key');
      expect(methods[0].type).toBe('apiKey');
    });

    it('should register OAuth2 auth method', () => {
      registry.registerAuthMethod({
        type: 'oauth2',
        id: 'oauth',
        label: 'OAuth Login',
        authorizationUrl: 'https://example.com/oauth/authorize',
        tokenUrl: 'https://example.com/oauth/token',
        scopes: ['read', 'write'],
        clientIdEnv: 'CLIENT_ID',
        clientSecretEnv: 'CLIENT_SECRET',
      });

      const methods = registry.getAuthMethods();
      expect(methods).toHaveLength(1);
      expect(methods[0].type).toBe('oauth2');
    });

    it('should throw error for duplicate auth method IDs', () => {
      registry.registerAuthMethod({
        type: 'apiKey',
        id: 'auth-1',
        label: 'Auth 1',
        fields: {},
      });

      expect(() => {
        registry.registerAuthMethod({
          type: 'apiKey',
          id: 'auth-1',
          label: 'Auth 1 Duplicate',
          fields: {},
        });
      }).toThrow('Auth method with id "auth-1" is already registered');
    });

    it('should allow multiple auth methods with different IDs', () => {
      registry.registerAuthMethod({
        type: 'apiKey',
        id: 'api-key',
        label: 'API Key',
        fields: {},
      });

      registry.registerAuthMethod({
        type: 'oauth2',
        id: 'oauth',
        label: 'OAuth',
        authorizationUrl: 'https://example.com/oauth/authorize',
        tokenUrl: 'https://example.com/oauth/token',
        scopes: [],
        clientIdEnv: 'CLIENT_ID',
        clientSecretEnv: 'CLIENT_SECRET',
      });

      const methods = registry.getAuthMethods();
      expect(methods).toHaveLength(2);
    });
  });

  describe('Route Registration', () => {
    it('should register routes', () => {
      const handler = async (req: any, res: any) => {
        res.json({ ok: true });
      };

      registry.registerRoute({
        method: 'POST',
        path: '/webhook',
        handler,
      });

      const routes = registry.getRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].method).toBe('POST');
      expect(routes[0].path).toBe('/webhook');
      expect(routes[0].handler).toBe(handler);
    });

    it('should allow multiple routes', () => {
      registry.registerRoute({
        method: 'GET',
        path: '/health',
        handler: async () => {},
      });

      registry.registerRoute({
        method: 'POST',
        path: '/webhook',
        handler: async () => {},
      });

      const routes = registry.getRoutes();
      expect(routes).toHaveLength(2);
    });

    it('should allow duplicate paths with different methods', () => {
      registry.registerRoute({
        method: 'GET',
        path: '/data',
        handler: async () => {},
      });

      registry.registerRoute({
        method: 'POST',
        path: '/data',
        handler: async () => {},
      });

      const routes = registry.getRoutes();
      expect(routes).toHaveLength(2);
      expect(routes[0].method).toBe('GET');
      expect(routes[1].method).toBe('POST');
    });
  });

  describe('UI Extension Registration', () => {
    it('should register UI extensions', () => {
      registry.registerUIExtension({
        id: 'settings-panel',
        location: 'plugin-settings',
        component: 'SettingsPanel.vue',
      });

      const extensions = registry.getUIExtensions();
      expect(extensions).toHaveLength(1);
      expect(extensions[0].id).toBe('settings-panel');
      expect(extensions[0].location).toBe('plugin-settings');
    });

    it('should allow multiple UI extensions', () => {
      registry.registerUIExtension({
        id: 'ext-1',
        location: 'plugin-settings',
        component: 'Ext1.vue',
      });

      registry.registerUIExtension({
        id: 'ext-2',
        location: 'conversation-sidebar',
        component: 'Ext2.vue',
      });

      const extensions = registry.getUIExtensions();
      expect(extensions).toHaveLength(2);
    });

    it('should include props in UI extensions', () => {
      registry.registerUIExtension({
        id: 'ext-1',
        location: 'plugin-settings',
        component: 'Ext1.vue',
        props: {
          theme: 'dark',
          size: 'large',
        },
      });

      const extensions = registry.getUIExtensions();
      expect(extensions[0].props).toEqual({
        theme: 'dark',
        size: 'large',
      });
    });
  });

  describe('Complete Registry State', () => {
    it('should maintain all registrations independently', () => {
      // Register config
      registry.registerConfig({
        apiKey: { type: 'string', label: 'API Key' },
      });

      // Register auth
      registry.registerAuthMethod({
        type: 'apiKey',
        id: 'api-key',
        label: 'API Key',
        fields: {},
      });

      // Register route
      registry.registerRoute({
        method: 'POST',
        path: '/webhook',
        handler: async () => {},
      });

      // Register UI
      registry.registerUIExtension({
        id: 'settings',
        location: 'plugin-settings',
        component: 'Settings.vue',
      });

      // Verify all are stored
      expect(registry.hasConfigField('apiKey')).toBe(true);
      expect(registry.getAuthMethods()).toHaveLength(1);
      expect(registry.getRoutes()).toHaveLength(1);
      expect(registry.getUIExtensions()).toHaveLength(1);
    });
  });
});
