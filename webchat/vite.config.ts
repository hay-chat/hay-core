import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

// Plugin to inline CSS into JS bundle.
// The injection code is added at the END of the chunk (before the
// sourceMappingURL comment), never prepended: prepending shifts every line and
// column of the already-generated sourcemap, so production stack traces and
// Lighthouse would point at the wrong code. Appending leaves every mapping
// intact. Running the injection last is safe: the whole bundle executes
// synchronously, so the <style> is in place before the browser paints.
function inlineCssPlugin() {
  return {
    name: "inline-css",
    apply: "build",
    enforce: "post",
    generateBundle(options, bundle) {
      const cssFiles = Object.keys(bundle).filter((i) => i.endsWith(".css"));
      const jsFiles = Object.keys(bundle).filter((i) => i.endsWith(".js") && !i.endsWith(".es.js"));

      cssFiles.forEach((cssFileName) => {
        const cssChunk = bundle[cssFileName];
        if (cssChunk.type === "asset" && typeof cssChunk.source === "string") {
          const cssInjectionCode = `(function(){if(typeof document!=="undefined"){var s=document.createElement("style");s.textContent=${JSON.stringify(cssChunk.source)};document.head.appendChild(s);}})();`;

          jsFiles.forEach((jsFileName) => {
            const jsChunk = bundle[jsFileName];
            if (jsChunk.type === "chunk") {
              const mapComment = jsChunk.code.lastIndexOf("\n//# sourceMappingURL=");
              jsChunk.code =
                mapComment === -1
                  ? `${jsChunk.code}\n${cssInjectionCode}\n`
                  : `${jsChunk.code.slice(0, mapComment)}\n${cssInjectionCode}${jsChunk.code.slice(mapComment)}`;
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
    // Vue compile-time feature flags. All components use <script setup>, so the
    // Options API can be tree-shaken; devtools and hydration-mismatch details
    // are development aids that should not ship to merchants' storefronts.
    __VUE_OPTIONS_API__: JSON.stringify(false),
    __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
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
