import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { AgentService } from "../../../services/agent.service";
import { TRPCError } from "@trpc/server";

const agentService = new AgentService();

const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  instructions: z.any().optional(),
  tone: z.string().optional(),
  avoid: z.string().optional(),
  trigger: z.string().optional(),
  humanHandoffAvailableInstructions: z.any().optional(),
  humanHandoffUnavailableInstructions: z.any().optional(),
  testMode: z.boolean().nullable().optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  instructions: z.any().optional(),
  tone: z.string().optional(),
  avoid: z.string().optional(),
  trigger: z.string().optional(),
  humanHandoffAvailableInstructions: z.any().optional(),
  humanHandoffUnavailableInstructions: z.any().optional(),
  testMode: z.boolean().nullable().optional(),
});

export const agentsRouter = t.router({
  list: authenticatedProcedure.query(async ({ ctx }) => {
    const agents = await agentService.getAgents(ctx.organizationId!);
    return agents;
  }),

  get: authenticatedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const agents = await agentService.getAgents(ctx.organizationId!);
      const agent = agents.find((a) => a.id === input.id);

      if (!agent) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found",
        });
      }

      return agent;
    }),

  create: authenticatedProcedure.input(createAgentSchema).mutation(async ({ ctx, input }) => {
    const agent = await agentService.createAgent(ctx.organizationId!, input as any);
    return agent;
  }),

  update: authenticatedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: updateAgentSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const agent = await agentService.updateAgent(ctx.organizationId!, input.id, input.data);

      if (!agent) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found",
        });
      }

      return agent;
    }),

  delete: authenticatedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deleted = await agentService.deleteAgent(ctx.organizationId!, input.id);

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found or already deleted",
        });
      }

      return {
        success: true,
        message: "Agent deleted successfully",
      };
    }),
});
