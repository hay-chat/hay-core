import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  define: {
    // Define process.env for Vue in production mode
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: "dist",
    lib: {
      entry: path.resolve(__dirname, "src/main.ts"),
      name: "HayChat",
      formats: ["umd", "es"],
      fileName: (format) => `widget.${format === "es" ? "es.js" : "js"}`,
    },
    rollupOptions: {
      // Bundle Vue with the widget for self-contained deployment
      external: [],
      output: {
        globals: {},
        assetFileNames: (assetInfo) => {
          // Keep widget.css as the CSS filename
          if (assetInfo.name === "style.css") {
            return "widget.css";
          }
          return assetInfo.name || "";
        },
      },
    },
    cssCodeSplit: false, // Bundle all CSS into one file
    minify: "terser",
    sourcemap: true,
    terserOptions: {
      compress: {
        drop_console: false, // Keep console for debugging
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5174,
    cors: true,
  },
});
