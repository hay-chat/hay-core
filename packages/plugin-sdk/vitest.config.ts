import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './sdk'),
      '@types': resolve(__dirname, './types'),
    },
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
