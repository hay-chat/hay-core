import { router, t } from "@/trpc";
import { authRouter } from "./auth";
import { documentsRouter } from "./documents";

const openRouter = router({
  auth: authRouter,
});

const protectedRouter = router({
  documents: documentsRouter,
});

export const v1Router = t.mergeRouters(openRouter, protectedRouter);

export type V1Router = typeof v1Router;
