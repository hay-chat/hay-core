import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

/**
 * Vite configuration for building Chatwoot plugin UI components.
 *
 * Builds Vue components as a UMD bundle with Vue externalized as a global.
 * The bundle is dynamically loaded by the Hay dashboard at runtime.
 */
export default defineConfig({
  plugins: [vue()],
  build: {
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "components/index.ts"),
      formats: ["umd"],
      // Must match convertPluginIdToGlobalVar("hay-channel-chatwoot")
      name: "ChatwootPlugin",
      fileName: () => "ui.js",
    },
    outDir: "dist",
    rollupOptions: {
      external: ["vue"],
      output: {
        globals: { vue: "Vue" },
        assetFileNames: "style.[ext]",
      },
    },
  },
});
