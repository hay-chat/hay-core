import { router } from "@server/trpc";
import { authRouter } from "./auth";
import { documentsRouter } from "./documents";
import { agentsRouter } from "./agents";
import { playbooksRouter } from "./playbooks";

const AppRouter = router({
  auth: authRouter,
  documents: documentsRouter,
  agents: agentsRouter,
  playbooks: playbooksRouter,
});

export const v1Router = AppRouter;

export type V1Router = typeof v1Router;
