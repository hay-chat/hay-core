import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["mcp/tests/**/*.test.js", "src/**/*.test.ts"],
    environment: "node",
  },
});
