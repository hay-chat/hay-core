import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["mcp/tests/**/*.test.js", "src/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
