import { inferAsyncReturnType, initTRPC } from "@trpc/server";
import { createContext } from "vm";

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
export const t = initTRPC
  .context<inferAsyncReturnType<typeof createContext>>()
  .create();

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;
