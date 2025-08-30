import { v1Router } from "../routes/v1";
import { isAuthed } from "@server/trpc/middleware/auth";
import { withPagination } from "@server/trpc/middleware/pagination";
import { t, router, publicProcedure } from "./init";
import { createContext } from "./context";

// Re-export from init
export { t, router, publicProcedure, createContext };

// Re-export middleware
export { withPagination };

// Export the app router type for client-side type generation
export type AppRouter = typeof v1Router;

export const authenticatedProcedure = t.procedure.use(isAuthed);
