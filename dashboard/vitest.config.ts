import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// Unit and component tests. Component tests opt into a DOM per file with
// `// @vitest-environment jsdom` and stub Nuxt auto-imports (tests/component-harness.ts).
const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": root,
      "~": root,
      "@hay/form-schema": fileURLToPath(
        new URL("../packages/form-schema/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    // tests/*.spec.ts are Playwright specs (tasks/lessons.md).
    exclude: ["node_modules/**", ".nuxt/**", ".output/**", "tests/**/*.spec.ts"],
  },
});
