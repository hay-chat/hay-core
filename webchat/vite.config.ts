import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

/**
 * The chat chunk build (src/chat.ts): Vue, the chat window, socket, DPoP,
 * markdown. Output is hashed under dist/assets/ and served with an immutable
 * cache. widget.js (vite.loader.config.ts) is built after this one and reads
 * the chunk's file name from the manifest.
 *
 * Build: `vite build && vite build -c vite.loader.config.ts` (npm run build).
 */

// Inline the chat CSS into the chat entry chunk. The loader imports the chunk
// with a bare import(), so nothing would load a separate .css file.
// The injection code is added at the END of the chunk (before the
// sourceMappingURL comment), never prepended: prepending shifts every line and
// column of the already-generated sourcemap. The chunk is mounted only after it
// has fully evaluated, so the <style> is in place before anything renders.
function inlineCssPlugin(): Plugin {
  return {
    name: "inline-css",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const cssFiles = Object.keys(bundle).filter((name) => name.endsWith(".css"));
      const entry = Object.values(bundle).find(
        (file) => file.type === "chunk" && file.isEntry,
      );
      if (!entry || entry.type !== "chunk") return;

      for (const cssFileName of cssFiles) {
        const cssChunk = bundle[cssFileName];
        if (cssChunk.type !== "asset" || typeof cssChunk.source !== "string") continue;
        const injection = `(function(){if(typeof document!=="undefined"){var s=document.createElement("style");s.textContent=${JSON.stringify(cssChunk.source)};document.head.appendChild(s);}})();`;
        const mapComment = entry.code.lastIndexOf("\n//# sourceMappingURL=");
        entry.code =
          mapComment === -1
            ? `${entry.code}\n${injection}\n`
            : `${entry.code.slice(0, mapComment)}\n${injection}${entry.code.slice(mapComment)}`;
        delete bundle[cssFileName];
      }
    },
  };
}

export default defineConfig({
  plugins: [vue(), inlineCssPlugin()],
  // Relative base: the locale chunks are imported relative to the chat chunk
  // (import.meta.url), wherever the widget is hosted.
  base: "./",
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
    emptyOutDir: true,
    manifest: true,
    modulePreload: false,
    cssCodeSplit: false, // one CSS file, inlined into the chat chunk by the plugin
    minify: "terser",
    sourcemap: true,
    rollupOptions: {
      input: { chat: path.resolve(__dirname, "src/chat.ts") },
      // Keep mountChat exported: the loader calls it.
      preserveEntrySignatures: "exports-only",
      output: {
        format: "es",
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
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
