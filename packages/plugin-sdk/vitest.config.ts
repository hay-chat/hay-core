import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@types', replacement: resolve(__dirname, './types') },
      // Core plugins (plugins/core/*) import the SDK by package name; the
      // core-plugin label check loads their sources directly.
      { find: /^@hay\/plugin-sdk\/types$/, replacement: resolve(__dirname, './types/index.ts') },
      { find: /^@hay\/plugin-sdk$/, replacement: resolve(__dirname, './sdk/index.ts') },
      { find: /^@\//, replacement: resolve(__dirname, './sdk') + '/' },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'examples'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        'dist',
        'examples',
        '**/*.test.ts',
        '**/__test-*.ts',
      ],
    },
    // Support for TypeScript type imports
    typecheck: {
      enabled: false,
    },
  },
});
