import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

/**
 * Vite configuration for building Zendesk plugin UI components.
 *
 * This builds Vue components as a UMD bundle that expects Vue as a global variable.
 * The bundle can be dynamically loaded by the Hay dashboard at runtime.
 */
export default defineConfig({
  plugins: [vue()],
  build: {
    emptyOutDir: false, // Don't clean dist/ to preserve index.js from TypeScript
    lib: {
      entry: path.resolve(__dirname, 'components/index.ts'),
      formats: ['umd'], // Use UMD format instead of ES modules
      name: 'ZendeskPlugin', // Global variable name for the bundle
      fileName: () => 'ui.js',
    },
    outDir: 'dist',
    rollupOptions: {
      // Externalize Vue - it will be provided by the dashboard as a global
      external: ['vue'],
      output: {
        globals: {
          vue: 'Vue', // Map 'vue' import to global 'Vue' variable
        },
      },
    },
  },
});
