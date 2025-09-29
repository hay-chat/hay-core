import { router } from "@server/trpc";
import { authRouter } from "./auth";
import { documentsRouter } from "./documents";
import { agentsRouter } from "./agents";
import { playbooksRouter } from "./playbooks";
import { conversationsRouter } from "./conversations";
import { embeddingsRouter } from "./embeddings";
import { customersRouter } from "./customers";
import { pluginsRouter } from "./plugins";
import { webConversationsRouter } from "./web-conversations";
import { analyticsRouter } from "./analytics";
import { organizationsRouter } from "./organizations";
import { pluginRouterRegistry } from "@server/services/plugin-router-registry.service";

// Core routers - always available
const coreRouters = {
  auth: authRouter,
  documents: documentsRouter,
  agents: agentsRouter,
  playbooks: playbooksRouter,
  conversations: conversationsRouter,
  embeddings: embeddingsRouter,
  customers: customersRouter,
  plugins: pluginsRouter,
  webConversations: webConversationsRouter,
  analytics: analyticsRouter,
  organizations: organizationsRouter,
};

// Create v1Router with core + plugin routers
// Plugins will register their routers dynamically
export const createV1Router = () => {
  return pluginRouterRegistry.createMergedRouter(coreRouters);
};

// Export initial router (will be updated when plugins register)
export const v1Router = router(coreRouters);

export type V1Router = typeof v1Router;
