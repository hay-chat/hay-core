import { t, authenticatedProcedure } from "@server/trpc";
import { AppDataSource } from "@server/database/data-source";
import { Agent } from "@server/database/entities/agent.entity";
import { Playbook } from "@server/database/entities/playbook.entity";
import { Document } from "@server/entities/document.entity";
import { Conversation } from "@server/database/entities/conversation.entity";
import { PluginInstance } from "@server/entities/plugin-instance.entity";

export const onboardingRouter = t.router({
  getProgress: authenticatedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId!;

    // Query all required data in parallel for performance
    const [enabledPluginsCount, agentsCount, documentsCount, playbooksCount, conversationsCount] =
      await Promise.all([
        // Step 1: Count enabled plugin instances (integrations)
        AppDataSource.getRepository(PluginInstance).count({
          where: {
            organizationId,
            enabled: true,
          },
        }),
        // Step 2: Count agents
        AppDataSource.getRepository(Agent).count({
          where: { organization_id: organizationId },
        }),
        // Step 3: Count documents (training data)
        AppDataSource.getRepository(Document).count({
          where: { organizationId },
        }),
        // Step 4: Count playbooks
        AppDataSource.getRepository(Playbook).count({
          where: { organization_id: organizationId },
        }),
        // Step 5: Check if at least one conversation exist
        AppDataSource.getRepository(Conversation).count({
          where: { organization_id: organizationId },
        }),
      ]);

    // Return minimal data - presentation logic handled in frontend
    const steps = [
      {
        id: "integrations",
        completed: enabledPluginsCount > 0,
        count: enabledPluginsCount,
      },
      {
        id: "agent",
        completed: agentsCount > 0,
        count: agentsCount,
      },
      {
        id: "documents",
        completed: documentsCount > 0,
        count: documentsCount,
      },
      {
        id: "playbook",
        completed: playbooksCount > 0,
        count: playbooksCount,
      },
      {
        id: "playground",
        completed: conversationsCount > 0,
        count: conversationsCount,
      },
    ];

    return {
      steps,
    };
  }),
});
