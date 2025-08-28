import { v1Router } from "../routes/v1";
import { isAuthed } from "@server/trpc/middleware/auth";
import { t, router, publicProcedure } from "./init";
import { createContext } from "./context";

// Re-export from init
export { t, router, publicProcedure, createContext };

// Export the app router type for client-side type generation
export type AppRouter = typeof v1Router;

export const authenticatedProcedure = t.procedure.use(isAuthed);
