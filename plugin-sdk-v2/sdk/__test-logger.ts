/**
 * Test file to verify logger implementation works correctly.
 * This file is not part of the build - it's just for validation.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { Logger, createLogger, type LoggerContext } from './logger';
import type { HayLogger } from '../types';

// Test 1: Basic logger creation
const basicLogger = new Logger();
basicLogger.info('Test message');
basicLogger.debug('Debug info');
basicLogger.warn('Warning message');
basicLogger.error('Error message');

// Test 2: Logger with context
const contextLogger = new Logger({
  orgId: 'org-123',
  pluginId: 'stripe',
});

contextLogger.info('Plugin started');
contextLogger.warn('Rate limit approaching', { remaining: 10 });
contextLogger.error('Operation failed', { code: 500, reason: 'auth_failed' });
contextLogger.debug('Config loaded', { fields: ['apiKey', 'maxRetries'] });

// Test 3: Logger with partial context
const orgOnlyLogger = new Logger({ orgId: 'org-456' });
orgOnlyLogger.info('Organization-level log');

const pluginOnlyLogger = new Logger({ pluginId: 'shopify' });
pluginOnlyLogger.info('Plugin-level log');

// Test 4: createLogger convenience function
const convenLogger = createLogger({
  orgId: 'org-789',
  pluginId: 'woocommerce',
});

convenLogger.info('Created with convenience function');

// Test 5: Child logger
const parentLogger = new Logger({ pluginId: 'test-plugin' });
const childLogger = parentLogger.child({ orgId: 'org-abc' });

childLogger.info('Child logger with merged context');

// Test 6: Metadata with Error object
const err = new Error('Test error');
contextLogger.error('Exception occurred', err);

// Test 7: Metadata with complex object
contextLogger.info('Complex metadata', {
  user: { id: 'user-123', name: 'John' },
  action: 'update',
  timestamp: Date.now(),
  nested: {
    deep: {
      value: 42,
    },
  },
});

// Test 8: No metadata
contextLogger.info('Simple message without metadata');

// Test 9: Type compatibility with HayLogger interface
const loggerAsInterface: HayLogger = new Logger({
  orgId: 'org-test',
  pluginId: 'test',
});

loggerAsInterface.debug('Debug via interface');
loggerAsInterface.info('Info via interface');
loggerAsInterface.warn('Warn via interface');
loggerAsInterface.error('Error via interface');

// Test 10: Multiple loggers with different contexts
const logger1 = createLogger({ pluginId: 'plugin-1' });
const logger2 = createLogger({ pluginId: 'plugin-2' });
const logger3 = createLogger({ orgId: 'org-1', pluginId: 'plugin-3' });

logger1.info('Message from plugin 1');
logger2.info('Message from plugin 2');
logger3.info('Message from plugin 3 with org context');

// This file should compile without errors
export {};
