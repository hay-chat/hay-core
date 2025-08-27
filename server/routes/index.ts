import { v1Router } from "./v1";

// Export v1Router directly as the appRouter
export const appRouter = v1Router;

export type AppRouter = typeof appRouter;
