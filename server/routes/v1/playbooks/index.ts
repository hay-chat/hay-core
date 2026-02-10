import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { PlaybookService } from "../../../services/playbook.service";
import { PlaybookStatus } from "../../../database/entities/playbook.entity";
import { TRPCError } from "@trpc/server";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { LLMService } from "../../../services/core/llm.service";
import { PromptService } from "../../../services/prompt.service";
import { documentRepository } from "../../../repositories/document.repository";
import { In } from "typeorm";

const playbookService = new PlaybookService();

const playbookStatusEnum = z.enum([
  PlaybookStatus.DRAFT,
  PlaybookStatus.ACTIVE,
  PlaybookStatus.ARCHIVED,
]);

const createPlaybookSchema = z.object({
  title: z.string().min(1).max(255),
  trigger: z.string().min(1).max(255),
  description: z.string().optional(),
  instructions: z.any().optional(),
  status: playbookStatusEnum.optional().default(PlaybookStatus.DRAFT),
  agentIds: z.array(z.string().uuid()).optional(),
});

const updatePlaybookSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  trigger: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  instructions: z.any().optional(),
  status: playbookStatusEnum.optional(),
  agentIds: z.array(z.string().uuid()).optional(),
});

export const playbooksRouter = t.router({
  list: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.READ).query(async ({ ctx }) => {
    const playbooks = await playbookService.getPlaybooks(ctx.organizationId!);
    return playbooks;
  }),

  listByStatus: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.READ)
    .input(
      z.object({
        status: playbookStatusEnum,
      }),
    )
    .query(async ({ ctx, input }) => {
      const playbooks = await playbookService.getPlaybooksByStatus(
        ctx.organizationId!,
        input.status,
      );
      return playbooks;
    }),

  get: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.READ)
    .input(
      z.object({
        id: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const playbook = await playbookService.getPlaybook(ctx.organizationId!, input.id);

      if (!playbook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found",
        });
      }

      return playbook;
    }),

  create: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.CREATE)
    .input(createPlaybookSchema)
    .mutation(async ({ ctx, input }) => {
      const playbook = await playbookService.createPlaybook(ctx.organizationId!, input as any);
      return playbook;
    }),

  update: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(
      z.object({
        id: z.string().uuid(),
        data: updatePlaybookSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const playbook = await playbookService.updatePlaybook(
        ctx.organizationId!,
        input.id,
        input.data,
      );

      if (!playbook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found",
        });
      }

      return playbook;
    }),

  delete: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.DELETE)
    .input(
      z.object({
        id: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deleted = await playbookService.deletePlaybook(ctx.organizationId!, input.id);

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found",
        });
      }

      return { success: true };
    }),

  addAgent: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(
      z.object({
        playbookId: z.string().uuid(),
        agentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const playbook = await playbookService.addAgentToPlaybook(
          ctx.organizationId!,
          input.playbookId,
          input.agentId,
        );

        if (!playbook) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Playbook not found",
          });
        }

        return playbook;
      } catch (error) {
        if (error instanceof Error && error.message === "Agent not found") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found",
          });
        }
        throw error;
      }
    }),

  removeAgent: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(
      z.object({
        playbookId: z.string().uuid(),
        agentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const playbook = await playbookService.removeAgentFromPlaybook(
        ctx.organizationId!,
        input.playbookId,
        input.agentId,
      );

      if (!playbook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found",
        });
      }

      return playbook;
    }),

  generateInstructions: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.CREATE)
    .input(
      z.object({
        purpose: z.string().min(1),
        actions: z
          .array(z.object({ name: z.string(), description: z.string(), pluginName: z.string() }))
          .optional()
          .default([]),
        documentIds: z.array(z.string().uuid()).optional().default([]),
        escalationRules: z.string().optional().default(""),
        boundaries: z.string().optional().default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const promptService = PromptService.getInstance();
      const llmService = new LLMService();

      // Fetch document metadata for the provided IDs
      let documents: { title: string; description: string }[] = [];
      if (input.documentIds.length > 0) {
        const docs = await documentRepository.findByOrganization(ctx.organizationId!, {
          where: { id: In(input.documentIds) } as any,
          select: ["id", "title", "description"],
        });
        documents = docs.map((doc) => ({
          title: doc.title || "Untitled",
          description: doc.description || "",
        }));
      }

      // Render the prompt template
      const prompt = await promptService.getPrompt("playbook/generate-instructions", {
        purpose: input.purpose,
        actions: input.actions,
        documents,
        escalationRules: input.escalationRules,
        boundaries: input.boundaries,
      });

      const jsonSchema = {
        type: "object",
        properties: {
          title: { type: "string" },
          trigger: { type: "string" },
          description: { type: "string" },
          instructions: { type: "string" },
        },
        required: ["title", "trigger", "description", "instructions"],
        additionalProperties: false,
      };

      const response = await llmService.invoke({
        history: prompt,
        jsonSchema,
        temperature: 0.7,
        max_tokens: 4000,
      });

      try {
        return JSON.parse(response);
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to parse generated instructions",
        });
      }
    }),
});
