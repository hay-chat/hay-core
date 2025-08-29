// Auto-generated tRPC types - DO NOT EDIT
// Run 'npm run generate:trpc' to regenerate

import type { inferRouterOutputs, inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../server/trpc/index";
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;

// Re-export the AppRouter type for convenience
export type { AppRouter } from "../../server/trpc/index";
