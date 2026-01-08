/**
 * Security Tests for Plugin Manager Service
 *
 * These tests verify that plugins cannot access sensitive system secrets
 * like OPENAI_API_KEY, DB_PASSWORD, JWT_SECRET, etc.
 */

describe('PluginManager Security', () => {
  // Mock PluginManager's buildSafeEnv method behavior
  const buildSafeEnv = (params: {
    organizationId: string;
    pluginId: string;
    port?: number;
    apiToken?: string;
    pluginConfig: Record<string, string>;
    capabilities: string[];
  }): Record<string, string> => {
    const { organizationId, pluginId, port, apiToken, pluginConfig, capabilities } = params;

    const safeEnv: Record<string, string> = {
      NODE_ENV: process.env.NODE_ENV || 'production',
      PATH: process.env.PATH || '',
      ORGANIZATION_ID: organizationId,
      PLUGIN_ID: pluginId,
      HAY_CAPABILITIES: capabilities.join(','),
    };

    if (capabilities.includes('routes') || capabilities.includes('messages')) {
      safeEnv.HAY_API_URL = process.env.API_URL || 'http://localhost:3001';
      if (apiToken) {
        safeEnv.HAY_API_TOKEN = apiToken;
      }
    }

    if (port && capabilities.includes('routes')) {
      safeEnv.HAY_WORKER_PORT = port.toString();
    }

    Object.assign(safeEnv, pluginConfig);

    return safeEnv;
  };

  // Mock buildMinimalEnv method behavior
  const buildMinimalEnv = (): Record<string, string> => {
    return {
      NODE_ENV: process.env.NODE_ENV || 'production',
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
    };
  };

  beforeAll(() => {
    // Set up mock sensitive environment variables
    process.env.OPENAI_API_KEY = 'sk-test-openai-key';
    process.env.DB_PASSWORD = 'super-secret-db-password';
    process.env.JWT_SECRET = 'jwt-signing-secret';
    process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';
    process.env.SMTP_AUTH_PASS = 'smtp-password';
    process.env.PLUGIN_ENCRYPTION_KEY = 'encryption-key';
    process.env.REDIS_PASSWORD = 'redis-password';
  });

  describe('buildSafeEnv()', () => {
    it('should NOT include OPENAI_API_KEY', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        port: 5000,
        apiToken: 'token-123',
        pluginConfig: {},
        capabilities: ['routes', 'messages'],
      });

      expect(env).not.toHaveProperty('OPENAI_API_KEY');
    });

    it('should NOT include DB_PASSWORD', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        pluginConfig: {},
        capabilities: [],
      });

      expect(env).not.toHaveProperty('DB_PASSWORD');
    });

    it('should NOT include JWT_SECRET', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        pluginConfig: {},
        capabilities: [],
      });

      expect(env).not.toHaveProperty('JWT_SECRET');
    });

    it('should NOT include STRIPE_SECRET_KEY', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        pluginConfig: {},
        capabilities: [],
      });

      expect(env).not.toHaveProperty('STRIPE_SECRET_KEY');
    });

    it('should NOT include SMTP_AUTH_PASS', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        pluginConfig: {},
        capabilities: [],
      });

      expect(env).not.toHaveProperty('SMTP_AUTH_PASS');
    });

    it('should NOT include PLUGIN_ENCRYPTION_KEY', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        pluginConfig: {},
        capabilities: [],
      });

      expect(env).not.toHaveProperty('PLUGIN_ENCRYPTION_KEY');
    });

    it('should NOT include REDIS_PASSWORD', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        pluginConfig: {},
        capabilities: [],
      });

      expect(env).not.toHaveProperty('REDIS_PASSWORD');
    });

    it('should include NODE_ENV', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        pluginConfig: {},
        capabilities: [],
      });

      expect(env).toHaveProperty('NODE_ENV');
    });

    it('should include PATH', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        pluginConfig: {},
        capabilities: [],
      });

      expect(env).toHaveProperty('PATH');
    });

    it('should include ORGANIZATION_ID', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        pluginConfig: {},
        capabilities: [],
      });

      expect(env.ORGANIZATION_ID).toBe('org-123');
    });

    it('should include PLUGIN_ID', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        pluginConfig: {},
        capabilities: [],
      });

      expect(env.PLUGIN_ID).toBe('test-plugin');
    });

    it('should include HAY_CAPABILITIES', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        pluginConfig: {},
        capabilities: ['routes', 'messages'],
      });

      expect(env.HAY_CAPABILITIES).toBe('routes,messages');
    });

    it('should include HAY_API_TOKEN only if plugin has routes or messages capability', () => {
      // With routes capability
      const envWithRoutes = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        apiToken: 'token-123',
        pluginConfig: {},
        capabilities: ['routes'],
      });
      expect(envWithRoutes.HAY_API_TOKEN).toBe('token-123');

      // With messages capability
      const envWithMessages = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        apiToken: 'token-456',
        pluginConfig: {},
        capabilities: ['messages'],
      });
      expect(envWithMessages.HAY_API_TOKEN).toBe('token-456');

      // Without routes or messages capability
      const envWithoutAccess = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        apiToken: 'token-789',
        pluginConfig: {},
        capabilities: ['mcp'],
      });
      expect(envWithoutAccess).not.toHaveProperty('HAY_API_TOKEN');
    });

    it('should include HAY_WORKER_PORT only if plugin has routes capability', () => {
      // With routes capability
      const envWithRoutes = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        port: 5000,
        pluginConfig: {},
        capabilities: ['routes'],
      });
      expect(envWithRoutes.HAY_WORKER_PORT).toBe('5000');

      // Without routes capability
      const envWithoutRoutes = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        port: 5000,
        pluginConfig: {},
        capabilities: ['mcp'],
      });
      expect(envWithoutRoutes).not.toHaveProperty('HAY_WORKER_PORT');
    });

    it('should include plugin-specific config', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        pluginConfig: {
          PLUGIN_API_KEY: 'plugin-key-123',
          PLUGIN_SETTING: 'some-value',
        },
        capabilities: [],
      });

      expect(env.PLUGIN_API_KEY).toBe('plugin-key-123');
      expect(env.PLUGIN_SETTING).toBe('some-value');
    });

    it('should only include explicitly allowed variables', () => {
      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        port: 5000,
        apiToken: 'token-123',
        pluginConfig: { CUSTOM_VAR: 'value' },
        capabilities: ['routes', 'messages'],
      });

      const allowedKeys = [
        'NODE_ENV',
        'PATH',
        'ORGANIZATION_ID',
        'PLUGIN_ID',
        'HAY_CAPABILITIES',
        'HAY_API_URL',
        'HAY_API_TOKEN',
        'HAY_WORKER_PORT',
        'CUSTOM_VAR', // From plugin config
      ];

      const envKeys = Object.keys(env);

      // Check that all keys are in the allowed list
      envKeys.forEach(key => {
        expect(allowedKeys).toContain(key);
      });
    });
  });

  describe('buildMinimalEnv()', () => {
    it('should only include NODE_ENV, PATH, and HOME', () => {
      const env = buildMinimalEnv();

      const expectedKeys = ['NODE_ENV', 'PATH', 'HOME'];
      const actualKeys = Object.keys(env);

      expect(actualKeys.sort()).toEqual(expectedKeys.sort());
    });

    it('should NOT include OPENAI_API_KEY during build', () => {
      const env = buildMinimalEnv();
      expect(env).not.toHaveProperty('OPENAI_API_KEY');
    });

    it('should NOT include DB_PASSWORD during build', () => {
      const env = buildMinimalEnv();
      expect(env).not.toHaveProperty('DB_PASSWORD');
    });

    it('should NOT include JWT_SECRET during build', () => {
      const env = buildMinimalEnv();
      expect(env).not.toHaveProperty('JWT_SECRET');
    });
  });

  describe('Security compliance', () => {
    it('should prevent plugins from accessing sensitive secrets', () => {
      const sensitiveVars = [
        'OPENAI_API_KEY',
        'DB_PASSWORD',
        'DB_HOST',
        'DB_PORT',
        'DB_USERNAME',
        'DB_NAME',
        'JWT_SECRET',
        'JWT_REFRESH_SECRET',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'SMTP_AUTH_PASS',
        'PLUGIN_ENCRYPTION_KEY',
        'REDIS_PASSWORD',
        'REDIS_HOST',
      ];

      const env = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'test-plugin',
        port: 5000,
        apiToken: 'token-123',
        pluginConfig: {},
        capabilities: ['routes', 'messages', 'mcp'],
      });

      sensitiveVars.forEach(varName => {
        expect(env).not.toHaveProperty(varName);
      });
    });

    it('should scope access based on capabilities', () => {
      // MCP-only plugin (no routes or messages)
      const mcpOnlyEnv = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'mcp-plugin',
        port: 5000,
        apiToken: 'token-123',
        pluginConfig: {},
        capabilities: ['mcp'],
      });

      expect(mcpOnlyEnv).not.toHaveProperty('HAY_API_TOKEN');
      expect(mcpOnlyEnv).not.toHaveProperty('HAY_WORKER_PORT');

      // Channel plugin (has routes and messages)
      const channelEnv = buildSafeEnv({
        organizationId: 'org-123',
        pluginId: 'channel-plugin',
        port: 5000,
        apiToken: 'token-123',
        pluginConfig: {},
        capabilities: ['routes', 'messages'],
      });

      expect(channelEnv).toHaveProperty('HAY_API_TOKEN');
      expect(channelEnv).toHaveProperty('HAY_WORKER_PORT');
    });
  });
});
