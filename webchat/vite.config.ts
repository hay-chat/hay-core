import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

// Plugin to inline CSS into JS bundle
function inlineCssPlugin() {
  return {
    name: "inline-css",
    apply: "build",
    enforce: "post",
    generateBundle(options, bundle) {
      const cssFiles = Object.keys(bundle).filter((i) => i.endsWith(".css"));
      const jsFiles = Object.keys(bundle).filter((i) => i.endsWith(".js") && !i.endsWith(".es.js"));

      // Get CSS content and inject it into JS
      cssFiles.forEach((cssFileName) => {
        const cssChunk = bundle[cssFileName];
        if (cssChunk.type === "asset" && typeof cssChunk.source === "string") {
          const cssContent = cssChunk.source;

          // Inject CSS into each JS file
          jsFiles.forEach((jsFileName) => {
            const jsChunk = bundle[jsFileName];
            if (jsChunk.type === "chunk") {
              // Prepend CSS injection code to the JS bundle
              const cssInjectionCode = `
(function() {
  if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(cssContent)};
    document.head.appendChild(style);
  }
})();
`;
              jsChunk.code = cssInjectionCode + jsChunk.code;
            }
          });

          // Remove the CSS file from the bundle
          delete bundle[cssFileName];
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), inlineCssPlugin()],
  define: {
    // Define process.env for Vue in production mode
    "process.env.NODE_ENV": JSON.stringify("production"),
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
      },
    },
    cssCodeSplit: false, // Bundle all CSS into one file (will be inlined by plugin)
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
