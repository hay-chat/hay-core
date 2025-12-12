/**
 * Test file to verify all Phase 2 types work together correctly.
 * This file is not part of the build - it's just for validation.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import type {
  // Plugin core
  HayPluginDefinition,
  HayPluginFactory,

  // Contexts
  HayGlobalContext,
  HayStartContext,
  HayAuthValidationContext,
  HayConfigUpdateContext,
  HayDisableContext,

  // Logger
  HayLogger,

  // Config
  ConfigFieldDescriptor,
  ConfigFieldReference,

  // Auth
  ApiKeyAuthOptions,
  OAuth2AuthOptions,
  AuthState,

  // MCP
  McpServerInstance,
  ExternalMcpOptions,

  // UI & Routes
  UIExtensionDescriptor,
  HttpMethod,
  RouteHandler,
} from './index';

// Test comprehensive plugin definition
const testPlugin: HayPluginFactory = (globalCtx: HayGlobalContext) => {
  const { register, config, logger } = globalCtx;

  // Test config registration
  const configSchema: Record<string, ConfigFieldDescriptor> = {
    apiKey: {
      type: 'string',
      required: false,
      env: 'TEST_API_KEY',
      sensitive: true,
      label: 'API Key',
    },
    maxRetries: {
      type: 'number',
      default: 3,
    },
    enabled: {
      type: 'boolean',
      default: true,
    },
    metadata: {
      type: 'json',
    },
  };

  // Test field references
  const clientIdRef: ConfigFieldReference = config.field('clientId');
  const clientSecretRef: ConfigFieldReference = config.field('clientSecret');

  // Test route handler
  const webhookHandler: RouteHandler = async (req, res) => {
    logger.info('Webhook received');
    res.status(200).json({ ok: true });
  };

  // Test UI extension
  const uiExtension: UIExtensionDescriptor = {
    slot: 'after-settings',
    component: 'components/Settings.vue',
  };

  // Test auth options
  const apiKeyAuth: ApiKeyAuthOptions = {
    id: 'apiKey',
    label: 'API Key',
    configField: 'apiKey',
  };

  const oauth2Auth: OAuth2AuthOptions = {
    id: 'oauth',
    label: 'OAuth 2.0',
    authorizationUrl: 'https://example.com/oauth/authorize',
    tokenUrl: 'https://example.com/oauth/token',
    scopes: ['read', 'write'],
    clientId: clientIdRef,
    clientSecret: clientSecretRef,
  };

  // Test HTTP methods
  const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  return {
    name: 'Test Plugin',

    onInitialize(ctx: HayGlobalContext) {
      const { register, config, logger } = ctx;

      // Register config
      register.config(configSchema);

      // Register auth
      register.auth.apiKey(apiKeyAuth);
      register.auth.oauth2(oauth2Auth);

      // Register routes
      register.route('POST', '/webhook', webhookHandler);
      register.route('GET', '/health', (req, res) => res.json({ status: 'ok' }));

      // Register UI
      register.ui(uiExtension);

      logger.info('Plugin initialized');
    },

    async onStart(ctx: HayStartContext) {
      const { org, config, auth, mcp, logger } = ctx;

      logger.info(`Starting for org: ${org.id}`);

      // Test config runtime API
      const apiKey = config.get<string>('apiKey');
      const maxRetries = config.getOptional<number>('maxRetries');
      const keys = config.keys();

      // Test auth runtime API
      const authState: AuthState | null = auth.get();

      if (authState) {
        const { methodId, credentials } = authState;

        if (methodId === 'apiKey') {
          const key = String(credentials.apiKey);
          // Use key...
        } else if (methodId === 'oauth') {
          const token = String(credentials.accessToken);
          // Use token...
        }
      }

      // Test MCP local server
      await mcp.startLocal('test-mcp', (mcpCtx) => {
        const mcpApiKey = mcpCtx.config.get<string>('apiKey');
        const mcpAuth = mcpCtx.auth.get();

        // Return MCP instance
        const instance: McpServerInstance = {
          async stop() {
            mcpCtx.logger.info('MCP stopped');
          },
        };

        return instance;
      });

      // Test MCP external server
      const externalOpts: ExternalMcpOptions = {
        id: 'external-mcp',
        url: 'https://mcp.example.com',
        authHeaders: {
          Authorization: `Bearer ${apiKey}`,
        },
      };

      await mcp.startExternal(externalOpts);

      logger.info('Plugin started');
    },

    async onValidateAuth(ctx: HayAuthValidationContext) {
      const { org, config, auth, logger } = ctx;

      const authState = auth.get();
      if (!authState) return false;

      const { methodId, credentials } = authState;

      try {
        // Validate credentials...
        return true;
      } catch (err) {
        logger.error('Validation failed', err);
        return false;
      }
    },

    onConfigUpdate(ctx: HayConfigUpdateContext) {
      const { org, config, logger } = ctx;
      logger.info(`Config updated for org: ${org.id}`);
    },

    onDisable(ctx: HayDisableContext) {
      const { org, logger } = ctx;
      logger.info(`Plugin disabled for org: ${org.id}`);
    },
  };
};

// Test that logger works independently
const testLogger: HayLogger = {
  debug: (msg, meta) => console.log('[DEBUG]', msg, meta),
  info: (msg, meta) => console.log('[INFO]', msg, meta),
  warn: (msg, meta) => console.warn('[WARN]', msg, meta),
  error: (msg, meta) => console.error('[ERROR]', msg, meta),
};

// Verify definition type
const definition: HayPluginDefinition = testPlugin({} as HayGlobalContext);

// This file should compile without errors
export {};
