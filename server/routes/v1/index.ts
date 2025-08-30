import { router } from "@server/trpc";
import { authRouter } from "./auth";
import { documentsRouter } from "./documents";
import { agentsRouter } from "./agents";
import { playbooksRouter } from "./playbooks";
import { conversationsRouter } from "./conversations";
import { embeddingsRouter } from "./embeddings";

const AppRouter = router({
  auth: authRouter,
  documents: documentsRouter,
  agents: agentsRouter,
  playbooks: playbooksRouter,
  conversations: conversationsRouter,
  embeddings: embeddingsRouter,
});

export const v1Router = AppRouter;

export type V1Router = typeof v1Router;
