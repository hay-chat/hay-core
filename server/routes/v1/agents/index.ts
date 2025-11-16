import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { AgentService } from "../../../services/agent.service";
import { TRPCError } from "@trpc/server";
import { RESOURCES, ACTIONS } from "@server/types/scopes";

const agentService = new AgentService();

const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  instructions: z.any().optional(),
  tone: z.string().optional(),
  avoid: z.string().optional(),
  trigger: z.string().optional(),
  initialGreeting: z.string().optional(),
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
  initialGreeting: z.string().optional(),
  humanHandoffAvailableInstructions: z.any().optional(),
  humanHandoffUnavailableInstructions: z.any().optional(),
  testMode: z.boolean().nullable().optional(),
});

export const agentsRouter = t.router({
  list: scopedProcedure(RESOURCES.AGENTS, ACTIONS.READ).query(async ({ ctx }) => {
    const agents = await agentService.getAgents(ctx.organizationId!);
    return agents;
  }),

  get: scopedProcedure(RESOURCES.AGENTS, ACTIONS.READ)
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

  create: scopedProcedure(RESOURCES.AGENTS, ACTIONS.CREATE).input(createAgentSchema).mutation(async ({ ctx, input }) => {
    const agent = await agentService.createAgent(ctx.organizationId!, input as any);

    // Auto-set as default agent if this is the first agent for the organization
    const { organizationRepository } = await import("../../../repositories/organization.repository");
    const organization = await organizationRepository.findById(ctx.organizationId!);

    if (organization && !organization.defaultAgentId) {
      await organizationRepository.update(ctx.organizationId!, {
        defaultAgentId: agent.id,
      } as any);
    }

    return agent;
  }),

  update: scopedProcedure(RESOURCES.AGENTS, ACTIONS.UPDATE)
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

  delete: scopedProcedure(RESOURCES.AGENTS, ACTIONS.DELETE)
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

  setAsDefault: scopedProcedure(RESOURCES.AGENTS, ACTIONS.UPDATE)
    .input(
      z.object({
        agentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify agent exists and belongs to organization
      const agent = await agentService.getAgent(ctx.organizationId!, input.agentId);
      if (!agent) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found",
        });
      }

      // Update organization's default agent
      const { organizationRepository } = await import("../../../repositories/organization.repository");
      const organization = await organizationRepository.findById(ctx.organizationId!);

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      await organizationRepository.update(ctx.organizationId!, {
        defaultAgentId: input.agentId,
      } as any);

      return {
        success: true,
        message: "Default agent updated successfully",
        agentId: input.agentId,
      };
    }),
});
