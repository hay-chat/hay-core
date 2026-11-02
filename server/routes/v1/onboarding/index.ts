import { t, authenticatedProcedure } from "@server/trpc";
import { AppDataSource } from "@server/database/data-source";
import { Playbook } from "@server/database/entities/playbook.entity";
import { Document } from "@server/entities/document.entity";
import { Conversation } from "@server/database/entities/conversation.entity";
import { PluginInstance } from "@server/entities/plugin-instance.entity";
import { Organization } from "@server/entities/organization.entity";
import { hasTiptapContent } from "@server/types/tiptap.types";

export const onboardingRouter = t.router({
  getProgress: authenticatedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId!;

    // Query all required data in parallel for performance
    const [enabledPluginsCount, organization, documentsCount, playbooksCount, conversationsCount] =
      await Promise.all([
        // Step 1: Count enabled plugin instances (integrations)
        AppDataSource.getRepository(PluginInstance).count({
          where: {
            organizationId,
            enabled: true,
          },
        }),
        // Step 2: The assistant is described (name or instructions)
        AppDataSource.getRepository(Organization).findOne({
          where: { id: organizationId },
          select: { id: true, assistantName: true, assistantInstructions: true },
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
        id: "assistant",
        completed:
          !!organization?.assistantName?.trim() ||
          hasTiptapContent(organization?.assistantInstructions),
        count: 0,
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
