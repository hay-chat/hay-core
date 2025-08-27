import { router } from "@/trpc";
import { v1Router } from "./v1";

export const appRouter = router({
  v1: v1Router,
});

export type AppRouter = typeof appRouter;
