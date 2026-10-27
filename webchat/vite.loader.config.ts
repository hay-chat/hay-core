import { defineConfig } from "vite";
import fs from "fs";
import path from "path";

/**
 * widget.js, the loader every page loads (src/loader). A classic script (IIFE)
 * so the existing `<script src=".../widget.js" async>` snippets keep working.
 * No Vue: it paints the button and imports the hashed chat chunk built by
 * vite.config.ts, which must run first (npm run build does both).
 */

function chatEntryFile(): string {
  const manifestPath = path.resolve(__dirname, "dist/.vite/manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("Chat chunk manifest missing: run `vite build` before the loader build");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<
    string,
    { file: string; isEntry?: boolean }
  >;
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
  if (!entry) throw new Error("No entry in the chat chunk manifest");
  return entry.file;
}

export default defineConfig({
  define: {
    __HAY_CHAT_ENTRY__: JSON.stringify(chatEntryFile()),
  },
  build: {
    outDir: "dist",
    emptyOutDir: false, // the chat chunk is already there
    minify: "terser",
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, "src/loader/index.ts"),
      name: "HayChatLoader",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
