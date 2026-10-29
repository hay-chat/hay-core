import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { AgentService } from "../../../services/agent.service";
import { softLaunchReadinessService } from "@server/services/soft-launch-readiness.service";
import { sharedChannels } from "@server/services/agent-channel-routing";
import { organizationRepository } from "@server/repositories/organization.repository";
import { TRPCError } from "@trpc/server";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { SupportedLanguage } from "@server/types/language.types";
import { tiptapDocSchema } from "@server/types/tiptap.types";
import { handoffTicketConfigSchema } from "@server/types/handoff-ticket.types";
import { handoffTicketsService } from "@server/services/handoff-tickets/handoff-tickets.service";

const agentService = new AgentService();

export const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  instructions: tiptapDocSchema.nullable().optional(),
  tone: z.string().optional(),
  avoid: z.string().optional(),
  trigger: z.string().optional(),
  initialGreeting: z.string().optional(),
  humanHandoffAvailableInstructions: tiptapDocSchema.optional(),
  humanHandoffUnavailableInstructions: tiptapDocSchema.optional(),
  humanHandoffUnavailableTicket: handoffTicketConfigSchema.nullable().optional(),
  testMode: z.boolean().nullable().optional(),
  language: z.nativeEnum(SupportedLanguage).nullable().optional(),
  channels: z.array(z.string()).optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  instructions: tiptapDocSchema.nullable().optional(),
  tone: z.string().optional(),
  avoid: z.string().optional(),
  trigger: z.string().optional(),
  initialGreeting: z.string().optional(),
  humanHandoffAvailableInstructions: tiptapDocSchema.optional(),
  humanHandoffUnavailableInstructions: tiptapDocSchema.optional(),
  humanHandoffUnavailableTicket: handoffTicketConfigSchema.nullable().optional(),
  testMode: z.boolean().nullable().optional(),
  language: z.nativeEnum(SupportedLanguage).nullable().optional(),
  channels: z.array(z.string()).optional(),
});

/** A ticket hand-off must name a helpdesk plugin this organization has enabled. */
async function assertTicketProvider(
  organizationId: string,
  ticket: { pluginId: string } | null | undefined,
): Promise<void> {
  if (ticket && !(await handoffTicketsService.isProvider(organizationId, ticket.pluginId))) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That helpdesk is not connected, so it cannot create tickets",
    });
  }
}

export const agentsRouter = t.router({
  list: scopedProcedure(RESOURCES.AGENTS, ACTIONS.READ).query(async ({ ctx }) => {
    const agents = await agentService.getAgents(ctx.organizationId!);
    return agents;
  }),

  /**
   * Soft-launch readiness (D7-13): weekly approve/edit/block counts of the
   * agent's replies under Require Approval, and whether it may be safe to
   * turn approval off.
   */
  readiness: scopedProcedure(RESOURCES.AGENTS, ACTIONS.READ)
    .input(
      z
        .object({
          agentId: z.string().uuid().optional(),
          weeks: z.number().int().min(1).max(26).default(8),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) =>
      softLaunchReadinessService.forOrganization(ctx.organizationId!, {
        agentId: input?.agentId,
        weeks: input?.weeks ?? 8,
      }),
    ),

  /**
   * Channels assigned to more than one agent and the agent that answers on
   * each (D7-14), so the agent page can explain who replies.
   */
  sharedChannels: scopedProcedure(RESOURCES.AGENTS, ACTIONS.READ).query(async ({ ctx }) => {
    const [agents, organization] = await Promise.all([
      agentService.getAgents(ctx.organizationId!),
      organizationRepository.findById(ctx.organizationId!),
    ]);
    const names = new Map(agents.map((a) => [a.id, a.name]));
    return sharedChannels(agents, organization?.defaultAgentId).map((shared) => ({
      ...shared,
      agents: shared.agentIds.map((id) => ({ id, name: names.get(id) ?? "" })),
      responderName: shared.responderId ? (names.get(shared.responderId) ?? null) : null,
    }));
  }),

  /** Helpdesk plugins that can raise a ticket when nobody can take a hand-off. */
  ticketProviders: scopedProcedure(RESOURCES.AGENTS, ACTIONS.READ).query(async ({ ctx }) =>
    handoffTicketsService.listProviders(ctx.organizationId!),
  ),

  /** The ticket fields a merchant can prefill, read from their connected helpdesk account. */
  ticketForm: scopedProcedure(RESOURCES.AGENTS, ACTIONS.READ)
    .input(z.object({ pluginId: z.string().min(1).max(255) }))
    .query(async ({ ctx, input }) =>
      handoffTicketsService.readForm(ctx.organizationId!, input.pluginId),
    ),

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

  create: scopedProcedure(RESOURCES.AGENTS, ACTIONS.CREATE)
    .input(createAgentSchema)
    .mutation(async ({ ctx, input }) => {
      await assertTicketProvider(ctx.organizationId!, input.humanHandoffUnavailableTicket);
      const agent = await agentService.createAgent(ctx.organizationId!, input);

      // Auto-set as default agent if this is the first agent for the organization
      const { organizationRepository } =
        await import("../../../repositories/organization.repository");
      const organization = await organizationRepository.findById(ctx.organizationId!);

      if (organization && !organization.defaultAgentId) {
        await organizationRepository.update(ctx.organizationId!, {
          defaultAgentId: agent.id,
        });
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
      await assertTicketProvider(ctx.organizationId!, input.data.humanHandoffUnavailableTicket);
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
      const { organizationRepository } =
        await import("../../../repositories/organization.repository");
      const organization = await organizationRepository.findById(ctx.organizationId!);

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      await organizationRepository.update(ctx.organizationId!, {
        defaultAgentId: input.agentId,
      });

      return {
        success: true,
        message: "Default agent updated successfully",
        agentId: input.agentId,
      };
    }),
});
