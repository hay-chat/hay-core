/**
 * Global Test Setup
 * Runs before all tests
 */
import { jest, beforeAll, afterAll } from '@jest/globals';

// Set test environment
process.env.NODE_ENV = 'test';
process.env.TZ = 'UTC';

// Mock console methods to reduce noise during tests (optional)
// Uncomment if you want cleaner test output
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   // Keep error for debugging
// };

// Global test timeout
jest.setTimeout(30000); // 30 seconds

// Global setup
beforeAll(() => {
  console.log('🧪 Starting test suite...');
});

// Global teardown
afterAll(() => {
  console.log('✅ Test suite complete!');
});
