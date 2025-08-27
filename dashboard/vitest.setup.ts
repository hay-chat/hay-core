import { beforeEach } from 'vitest';

// Global test setup
beforeEach(() => {
  // Reset any global state between tests
});

// Mock window and global objects
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  },
  writable: true,
});

Object.defineProperty(window, 'location', {
  value: {
    href: '',
    origin: 'http://localhost:3000',
    protocol: 'http:',
    host: 'localhost:3000',
  },
  writable: true,
});

// Mock fetch globally
global.fetch = () =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
