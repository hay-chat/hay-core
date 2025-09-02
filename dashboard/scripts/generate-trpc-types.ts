import { writeFileSync } from "fs";
import { join } from "path";

// This script generates TypeScript types from your tRPC server
// Run this script whenever you update your server routes

const SERVER_URL = "http://localhost:3001";
const OUTPUT_PATH = join(__dirname, "../types/trpc.ts");

try {
  // Generate types using tRPC's built-in type generation
  const types = `// Auto-generated tRPC types - DO NOT EDIT
// Run 'npm run generate:trpc' to regenerate

import type { inferRouterOutputs, inferRouterInputs } from '@trpc/server';
import type { AppRouter } from '../../server/trpc';

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;

// Re-export the AppRouter type for convenience
export type { AppRouter } from '../../server/trpc';
`;

  writeFileSync(OUTPUT_PATH, types);
  console.log("✅ tRPC types generated successfully at:", OUTPUT_PATH);
} catch (error) {
  console.error("❌ Failed to generate tRPC types:", error);
  process.exit(1);
}
