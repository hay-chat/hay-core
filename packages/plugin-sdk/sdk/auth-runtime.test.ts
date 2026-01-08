import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAuthRuntimeAPI } from './auth-runtime.js';
import type { HayLogger, AuthState } from '../types/index.js';

describe('Auth Runtime API', () => {
  let logger: HayLogger;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  describe('Auth State Access', () => {
    it('should return auth state when configured', () => {
      const authState: AuthState = {
        methodId: 'api-key',
        credentials: {
          apiKey: 'test-key-123',
        },
      };

      const api = createAuthRuntimeAPI({ authState, logger });
      const result = api.get();

      expect(result).toEqual({
        methodId: 'api-key',
        credentials: {
          apiKey: 'test-key-123',
        },
      });

      expect(logger.debug).toHaveBeenCalledWith('Retrieved auth state', {
        methodId: 'api-key',
      });
    });

    it('should return null when no auth is configured', () => {
      const api = createAuthRuntimeAPI({ authState: null, logger });
      const result = api.get();

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        'No auth state configured for this organization',
      );
    });

    it('should return a copy of credentials to prevent mutations', () => {
      const authState: AuthState = {
        methodId: 'api-key',
        credentials: {
          apiKey: 'original-key',
        },
      };

      const api = createAuthRuntimeAPI({ authState, logger });
      const result1 = api.get();
      const result2 = api.get();

      // Mutate first result
      if (result1) {
        result1.credentials.apiKey = 'mutated-key';
      }

      // Second result should not be affected
      expect(result2?.credentials.apiKey).toBe('original-key');

      // Original should not be affected
      expect(authState.credentials.apiKey).toBe('original-key');
    });
  });

  describe('OAuth2 Auth State', () => {
    it('should handle OAuth2 credentials', () => {
      const authState: AuthState = {
        methodId: 'oauth',
        credentials: {
          accessToken: 'access-token-123',
          refreshToken: 'refresh-token-456',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      };

      const api = createAuthRuntimeAPI({ authState, logger });
      const result = api.get();

      expect(result).toEqual({
        methodId: 'oauth',
        credentials: {
          accessToken: 'access-token-123',
          refreshToken: 'refresh-token-456',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });
    });
  });

  describe('Auth State Validation', () => {
    it('should warn and return null when methodId is missing', () => {
      const authState = {
        credentials: { apiKey: 'test-key' },
      } as any;

      const api = createAuthRuntimeAPI({ authState, logger });
      const result = api.get();

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Invalid auth state: methodId is missing or not a string',
      );
    });

    it('should warn and return null when methodId is not a string', () => {
      const authState = {
        methodId: 123,
        credentials: { apiKey: 'test-key' },
      } as any;

      const api = createAuthRuntimeAPI({ authState, logger });
      const result = api.get();

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Invalid auth state: methodId is missing or not a string',
      );
    });

    it('should warn and return null when credentials is missing', () => {
      const authState = {
        methodId: 'api-key',
      } as any;

      const api = createAuthRuntimeAPI({ authState, logger });
      const result = api.get();

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Invalid auth state: credentials is missing or not an object',
      );
    });

    it('should warn and return null when credentials is not an object', () => {
      const authState = {
        methodId: 'api-key',
        credentials: 'not-an-object',
      } as any;

      const api = createAuthRuntimeAPI({ authState, logger });
      const result = api.get();

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Invalid auth state: credentials is missing or not an object',
      );
    });

    it('should accept empty credentials object', () => {
      const authState: AuthState = {
        methodId: 'custom-auth',
        credentials: {},
      };

      const api = createAuthRuntimeAPI({ authState, logger });
      const result = api.get();

      expect(result).toEqual({
        methodId: 'custom-auth',
        credentials: {},
      });
    });
  });

  describe('Multiple Calls', () => {
    it('should return consistent results on multiple calls', () => {
      const authState: AuthState = {
        methodId: 'api-key',
        credentials: {
          apiKey: 'test-key-123',
        },
      };

      const api = createAuthRuntimeAPI({ authState, logger });

      const result1 = api.get();
      const result2 = api.get();
      const result3 = api.get();

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
      expect(result1).toEqual({
        methodId: 'api-key',
        credentials: {
          apiKey: 'test-key-123',
        },
      });
    });

    it('should log debug message on each call', () => {
      const authState: AuthState = {
        methodId: 'api-key',
        credentials: { apiKey: 'test-key' },
      };

      const api = createAuthRuntimeAPI({ authState, logger });

      api.get();
      api.get();
      api.get();

      expect(logger.debug).toHaveBeenCalledTimes(3);
    });
  });

  describe('Different Auth Methods', () => {
    it('should handle API key auth', () => {
      const authState: AuthState = {
        methodId: 'api-key',
        credentials: {
          apiKey: 'sk_test_123',
        },
      };

      const api = createAuthRuntimeAPI({ authState, logger });
      const result = api.get();

      expect(result?.methodId).toBe('api-key');
      expect(result?.credentials).toEqual({ apiKey: 'sk_test_123' });
    });

    it('should handle OAuth2 auth', () => {
      const authState: AuthState = {
        methodId: 'oauth2',
        credentials: {
          accessToken: 'ya29.a0AfH6SMBx...',
          refreshToken: '1//0gQ...',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      };

      const api = createAuthRuntimeAPI({ authState, logger });
      const result = api.get();

      expect(result?.methodId).toBe('oauth2');
      expect(result?.credentials.accessToken).toBe('ya29.a0AfH6SMBx...');
      expect(result?.credentials.refreshToken).toBe('1//0gQ...');
    });

    it('should handle basic auth', () => {
      const authState: AuthState = {
        methodId: 'basic',
        credentials: {
          username: 'user@example.com',
          password: 'secure-password',
        },
      };

      const api = createAuthRuntimeAPI({ authState, logger });
      const result = api.get();

      expect(result?.methodId).toBe('basic');
      expect(result?.credentials).toEqual({
        username: 'user@example.com',
        password: 'secure-password',
      });
    });

    it('should handle custom auth methods', () => {
      const authState: AuthState = {
        methodId: 'custom-auth',
        credentials: {
          customField1: 'value1',
          customField2: 'value2',
          nested: {
            field: 'nested-value',
          },
        },
      };

      const api = createAuthRuntimeAPI({ authState, logger });
      const result = api.get();

      expect(result?.methodId).toBe('custom-auth');
      expect(result?.credentials).toEqual({
        customField1: 'value1',
        customField2: 'value2',
        nested: {
          field: 'nested-value',
        },
      });
    });
  });
});
