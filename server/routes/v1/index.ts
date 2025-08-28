import { router } from "@server/trpc";
import { authRouter } from "./auth";
import { documentsRouter } from "./documents";

const AppRouter = router({
  auth: authRouter,
  documents: documentsRouter,
});

export const v1Router = AppRouter;

export type V1Router = typeof v1Router;
