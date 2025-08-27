import { initTRPC } from "@trpc/server";
import { createContext } from "./context";
import { v1Router } from "../routes/v1";

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
export const t = initTRPC.context<typeof createContext>().create();

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;

// Export the app router type for client-side type generation
export type AppRouter = typeof v1Router;
