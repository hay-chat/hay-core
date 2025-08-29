import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { PlaybookService } from "../../../services/playbook.service";
import { PlaybookStatus } from "../../../database/entities/playbook.entity";
import { TRPCError } from "@trpc/server";

const playbookService = new PlaybookService();

const playbookStatusEnum = z.enum([
  PlaybookStatus.DRAFT,
  PlaybookStatus.ACTIVE,
  PlaybookStatus.ARCHIVED
]);

const createPlaybookSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  instructions: z.string().optional(),
  status: playbookStatusEnum.optional().default(PlaybookStatus.DRAFT),
  agentIds: z.array(z.string().uuid()).optional()
});

const updatePlaybookSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  status: playbookStatusEnum.optional(),
  agentIds: z.array(z.string().uuid()).optional()
});

export const playbooksRouter = t.router({
  list: authenticatedProcedure
    .query(async ({ ctx }) => {
      const playbooks = await playbookService.getPlaybooks(ctx.organizationId!);
      return playbooks;
    }),

  listByStatus: authenticatedProcedure
    .input(z.object({
      status: playbookStatusEnum
    }))
    .query(async ({ ctx, input }) => {
      const playbooks = await playbookService.getPlaybooksByStatus(
        ctx.organizationId!,
        input.status
      );
      return playbooks;
    }),

  get: authenticatedProcedure
    .input(z.object({
      id: z.string().uuid()
    }))
    .query(async ({ ctx, input }) => {
      const playbook = await playbookService.getPlaybook(
        ctx.organizationId!,
        input.id
      );

      if (!playbook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found"
        });
      }

      return playbook;
    }),

  create: authenticatedProcedure
    .input(createPlaybookSchema)
    .mutation(async ({ ctx, input }) => {
      const playbook = await playbookService.createPlaybook(
        ctx.organizationId!,
        input
      );
      return playbook;
    }),

  update: authenticatedProcedure
    .input(z.object({
      id: z.string().uuid(),
      data: updatePlaybookSchema
    }))
    .mutation(async ({ ctx, input }) => {
      const playbook = await playbookService.updatePlaybook(
        ctx.organizationId!,
        input.id,
        input.data
      );

      if (!playbook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found"
        });
      }

      return playbook;
    }),

  delete: authenticatedProcedure
    .input(z.object({
      id: z.string().uuid()
    }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await playbookService.deletePlaybook(
        ctx.organizationId!,
        input.id
      );

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found"
        });
      }

      return { success: true };
    }),

  addAgent: authenticatedProcedure
    .input(z.object({
      playbookId: z.string().uuid(),
      agentId: z.string().uuid()
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const playbook = await playbookService.addAgentToPlaybook(
          ctx.organizationId!,
          input.playbookId,
          input.agentId
        );

        if (!playbook) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Playbook not found"
          });
        }

        return playbook;
      } catch (error) {
        if (error instanceof Error && error.message === "Agent not found") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found"
          });
        }
        throw error;
      }
    }),

  removeAgent: authenticatedProcedure
    .input(z.object({
      playbookId: z.string().uuid(),
      agentId: z.string().uuid()
    }))
    .mutation(async ({ ctx, input }) => {
      const playbook = await playbookService.removeAgentFromPlaybook(
        ctx.organizationId!,
        input.playbookId,
        input.agentId
      );

      if (!playbook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found"
        });
      }

      return playbook;
    })
});