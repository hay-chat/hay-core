import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMcpRuntimeAPI, stopAllMcpServers } from './mcp-runtime.js';
import type { HayLogger, HayConfigRuntimeAPI, HayAuthRuntimeAPI, McpServerInstance } from '../types/index.js';

describe('MCP Runtime API', () => {
  let logger: HayLogger;
  let config: HayConfigRuntimeAPI;
  let auth: HayAuthRuntimeAPI;
  let onMcpServerStarted: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    config = {
      get: vi.fn(),
      getOptional: vi.fn(),
      keys: vi.fn(() => []),
    };

    auth = {
      get: vi.fn(() => null),
    };

    onMcpServerStarted = vi.fn();
  });

  describe('Local MCP Server', () => {
    it('should start a local MCP server', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger, onMcpServerStarted });

      const mockInstance: McpServerInstance = {
        name: 'test-server',
        version: '1.0.0',
        stop: vi.fn(),
      };

      const initializer = vi.fn(async () => mockInstance);

      await api.startLocal('test-server', initializer);

      expect(initializer).toHaveBeenCalledWith({
        config,
        auth,
        logger,
      });

      expect(logger.info).toHaveBeenCalledWith('Starting local MCP server: test-server');
      expect(logger.info).toHaveBeenCalledWith('Local MCP server started: test-server');

      expect(onMcpServerStarted).toHaveBeenCalledWith({
        id: 'test-server',
        type: 'local',
        instance: mockInstance,
      });
    });

    it('should validate server id is present', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger });

      await expect(
        api.startLocal('', async () => ({ name: 'test', version: '1.0.0' })),
      ).rejects.toThrow('MCP server id must be a non-empty string');
    });

    it('should validate initializer is a function', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger });

      await expect(
        api.startLocal('test', 'not-a-function' as any),
      ).rejects.toThrow('MCP server initializer must be a function');
    });

    it('should prevent duplicate server IDs', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger });

      const initializer = async () => ({
        name: 'test',
        version: '1.0.0',
      });

      await api.startLocal('duplicate-id', initializer);

      await expect(
        api.startLocal('duplicate-id', initializer),
      ).rejects.toThrow('MCP server with id "duplicate-id" is already running');
    });

    it('should validate initializer returns an object', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger });

      const badInitializer = async () => null as any;

      await expect(
        api.startLocal('test', badInitializer),
      ).rejects.toThrow('must return an object (McpServerInstance)');
    });

    it('should support sync initializers', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger, onMcpServerStarted });

      const mockInstance: McpServerInstance = {
        name: 'sync-server',
        version: '1.0.0',
      };

      const syncInitializer = () => mockInstance;

      await api.startLocal('sync-server', syncInitializer);

      expect(onMcpServerStarted).toHaveBeenCalledWith({
        id: 'sync-server',
        type: 'local',
        instance: mockInstance,
      });
    });

    it('should handle initializer errors gracefully', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger });

      const errorInitializer = async () => {
        throw new Error('Initialization failed');
      };

      await expect(
        api.startLocal('error-server', errorInitializer),
      ).rejects.toThrow('Initialization failed');

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to start local MCP server: error-server',
        expect.any(Error),
      );
    });

    it('should pass context to initializer', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger });

      const initializer = vi.fn(async (ctx) => ({
        name: 'context-test',
        version: '1.0.0',
      }));

      await api.startLocal('context-test', initializer);

      expect(initializer).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.any(Object),
          auth: expect.any(Object),
          logger: expect.any(Object),
        }),
      );
    });

    it('should log debug info about server instance', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger });

      const instanceWithStop: McpServerInstance = {
        name: 'test',
        version: '1.0.0',
        stop: vi.fn(),
      };

      await api.startLocal('test', async () => instanceWithStop);

      expect(logger.debug).toHaveBeenCalledWith('MCP server instance', {
        id: 'test',
        hasStop: true,
      });
    });
  });

  describe('External MCP Server', () => {
    it('should start an external MCP server', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger, onMcpServerStarted });

      await api.startExternal({
        id: 'external-server',
        url: 'http://localhost:3000',
      });

      expect(logger.info).toHaveBeenCalledWith('Starting external MCP server: external-server', {
        url: 'http://localhost:3000',
      });

      expect(logger.info).toHaveBeenCalledWith('External MCP server started: external-server', {
        url: 'http://localhost:3000',
      });

      expect(onMcpServerStarted).toHaveBeenCalledWith({
        id: 'external-server',
        type: 'external',
        options: {
          id: 'external-server',
          url: 'http://localhost:3000',
        },
      });
    });

    it('should validate options is an object', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger });

      await expect(
        api.startExternal(null as any),
      ).rejects.toThrow('External MCP options must be an object');
    });

    it('should validate server id is present', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger });

      await expect(
        api.startExternal({ id: '', url: 'http://localhost:3000' }),
      ).rejects.toThrow('External MCP server id must be a non-empty string');
    });

    it('should validate url is present', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger });

      await expect(
        api.startExternal({ id: 'test', url: '' }),
      ).rejects.toThrow('External MCP server url must be a non-empty string');
    });

    it('should prevent duplicate server IDs', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger });

      await api.startExternal({ id: 'duplicate', url: 'http://localhost:3000' });

      await expect(
        api.startExternal({ id: 'duplicate', url: 'http://localhost:3001' }),
      ).rejects.toThrow('MCP server with id "duplicate" is already running');
    });

    it('should support auth headers', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger, onMcpServerStarted });

      await api.startExternal({
        id: 'auth-server',
        url: 'http://localhost:3000',
        authHeaders: {
          Authorization: 'Bearer token123',
        },
      });

      expect(onMcpServerStarted).toHaveBeenCalledWith({
        id: 'auth-server',
        type: 'external',
        options: {
          id: 'auth-server',
          url: 'http://localhost:3000',
          authHeaders: {
            Authorization: 'Bearer token123',
          },
        },
      });
    });

    it('should validate authHeaders is an object', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger });

      await expect(
        api.startExternal({
          id: 'test',
          url: 'http://localhost:3000',
          authHeaders: 'not-an-object' as any,
        }),
      ).rejects.toThrow('External MCP server authHeaders must be an object');
    });

    it('should handle server start errors', async () => {
      const api = createMcpRuntimeAPI({
        config,
        auth,
        logger,
        onMcpServerStarted: async () => {
          throw new Error('Platform error');
        },
      });

      await expect(
        api.startExternal({ id: 'error-server', url: 'http://localhost:3000' }),
      ).rejects.toThrow('Platform error');

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to start external MCP server: error-server',
        expect.any(Error),
      );
    });
  });

  describe('Mixed Server Types', () => {
    it('should allow both local and external servers with different IDs', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger, onMcpServerStarted });

      await api.startLocal('local-server', async () => ({
        name: 'local',
        version: '1.0.0',
      }));

      await api.startExternal({
        id: 'external-server',
        url: 'http://localhost:3000',
      });

      expect(onMcpServerStarted).toHaveBeenCalledTimes(2);
    });

    it('should prevent duplicate IDs across server types', async () => {
      const api = createMcpRuntimeAPI({ config, auth, logger });

      await api.startLocal('duplicate-id', async () => ({
        name: 'local',
        version: '1.0.0',
      }));

      await expect(
        api.startExternal({ id: 'duplicate-id', url: 'http://localhost:3000' }),
      ).rejects.toThrow('MCP server with id "duplicate-id" is already running');
    });
  });

  describe('stopAllMcpServers', () => {
    it('should stop all local MCP servers', async () => {
      const servers = new Map();

      const stopFn1 = vi.fn(async () => {});
      const stopFn2 = vi.fn(async () => {});

      servers.set('server1', {
        id: 'server1',
        type: 'local',
        instance: {
          name: 'server1',
          version: '1.0.0',
          stop: stopFn1,
        },
      });

      servers.set('server2', {
        id: 'server2',
        type: 'local',
        instance: {
          name: 'server2',
          version: '1.0.0',
          stop: stopFn2,
        },
      });

      await stopAllMcpServers(servers, logger);

      expect(stopFn1).toHaveBeenCalled();
      expect(stopFn2).toHaveBeenCalled();
      expect(servers.size).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith('All MCP servers stopped');
    });

    it('should skip servers without stop method', async () => {
      const servers = new Map();

      servers.set('server1', {
        id: 'server1',
        type: 'local',
        instance: {
          name: 'server1',
          version: '1.0.0',
          // No stop method
        },
      });

      await stopAllMcpServers(servers, logger);

      expect(servers.size).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith('All MCP servers stopped');
    });

    it('should skip external servers', async () => {
      const servers = new Map();

      servers.set('external', {
        id: 'external',
        type: 'external',
        options: {
          id: 'external',
          url: 'http://localhost:3000',
        },
      });

      await stopAllMcpServers(servers, logger);

      expect(servers.size).toBe(0);
    });

    it('should handle stop errors gracefully', async () => {
      const servers = new Map();

      const errorStopFn = vi.fn(async () => {
        throw new Error('Stop failed');
      });

      servers.set('error-server', {
        id: 'error-server',
        type: 'local',
        instance: {
          name: 'error-server',
          version: '1.0.0',
          stop: errorStopFn,
        },
      });

      await stopAllMcpServers(servers, logger);

      expect(errorStopFn).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'Error stopping MCP server: error-server',
        expect.any(Error),
      );
      expect(servers.size).toBe(0);
    });

    it('should clear all servers even if some fail to stop', async () => {
      const servers = new Map();

      const successStopFn = vi.fn(async () => {});
      const errorStopFn = vi.fn(async () => {
        throw new Error('Stop failed');
      });

      servers.set('success-server', {
        id: 'success-server',
        type: 'local',
        instance: {
          name: 'success-server',
          version: '1.0.0',
          stop: successStopFn,
        },
      });

      servers.set('error-server', {
        id: 'error-server',
        type: 'local',
        instance: {
          name: 'error-server',
          version: '1.0.0',
          stop: errorStopFn,
        },
      });

      await stopAllMcpServers(servers, logger);

      expect(successStopFn).toHaveBeenCalled();
      expect(errorStopFn).toHaveBeenCalled();
      expect(servers.size).toBe(0);
    });
  });
});
