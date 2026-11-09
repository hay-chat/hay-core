import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { tiptapDocSchema } from "@server/types/tiptap.types";
import { handoffTicketConfigSchema } from "@server/types/handoff-ticket.types";
import { organizationService } from "@server/services/organization.service";
import { storageService } from "@server/services/storage.service";
import { auditLogService } from "@server/services/audit-log.service";
import { handoffTicketsService } from "@server/services/handoff-tickets/handoff-tickets.service";
import { softLaunchReadinessService } from "@server/services/soft-launch-readiness.service";
import type { Organization } from "@server/entities/organization.entity";

export const updateAssistantSchema = z.object({
  name: z.string().max(255).nullable().optional(),
  description: z.string().nullable().optional(),
  instructions: tiptapDocSchema.nullable().optional(),
  tone: z.string().nullable().optional(),
  avoid: z.string().nullable().optional(),
  initialGreeting: z.string().nullable().optional(),
  humanHandoffAvailableInstructions: tiptapDocSchema.nullable().optional(),
  humanHandoffUnavailableInstructions: tiptapDocSchema.nullable().optional(),
  humanHandoffUnavailableTicket: handoffTicketConfigSchema.nullable().optional(),
});

/** Empty text is "not set". */
function textOrNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim() ? value.trim() : null;
}

function toAssistant(organization: Organization) {
  return {
    name: organization.assistantName ?? null,
    description: organization.assistantDescription ?? null,
    avatarUrl: organization.assistantAvatarUpload
      ? storageService.getUrl(organization.assistantAvatarUpload)
      : null,
    instructions: organization.assistantInstructions ?? null,
    tone: organization.assistantTone ?? null,
    avoid: organization.assistantAvoid ?? null,
    initialGreeting: organization.initialGreeting ?? null,
    humanHandoffAvailableInstructions: organization.humanHandoffAvailableInstructions ?? null,
    humanHandoffUnavailableInstructions: organization.humanHandoffUnavailableInstructions ?? null,
    humanHandoffUnavailableTicket: organization.humanHandoffUnavailableTicket ?? null,
  };
}

async function loadOrganization(organizationId: string): Promise<Organization> {
  const organization = await organizationService.findOne(organizationId);
  if (!organization) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
  }
  return organization;
}

/** The organization's AI assistant: one per organization (name, persona, hand-off). */
export const assistantRouter = t.router({
  get: scopedProcedure(RESOURCES.ASSISTANT, ACTIONS.READ).query(async ({ ctx }) =>
    toAssistant(await loadOrganization(ctx.organizationId!)),
  ),

  update: scopedProcedure(RESOURCES.ASSISTANT, ACTIONS.UPDATE)
    .input(updateAssistantSchema)
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      await loadOrganization(organizationId);

      // A ticket hand-off must name a helpdesk plugin this organization has enabled.
      const ticket = input.humanHandoffUnavailableTicket;
      if (ticket && !(await handoffTicketsService.isProvider(organizationId, ticket.pluginId))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That helpdesk is not connected, so it cannot create tickets",
        });
      }

      const updated = await organizationService.update(organizationId, {
        assistantName: textOrNull(input.name),
        assistantDescription: textOrNull(input.description),
        assistantInstructions: input.instructions,
        assistantTone: textOrNull(input.tone),
        assistantAvoid: textOrNull(input.avoid),
        initialGreeting: textOrNull(input.initialGreeting),
        humanHandoffAvailableInstructions: input.humanHandoffAvailableInstructions,
        humanHandoffUnavailableInstructions: input.humanHandoffUnavailableInstructions,
        humanHandoffUnavailableTicket: input.humanHandoffUnavailableTicket,
      });
      await auditLogService.record({
        userId: ctx.user?.id,
        organizationId,
        action: "assistant.update",
        resource: "assistant",
        changes: { fields: Object.keys(input) },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      return toAssistant(updated);
    }),

  /**
   * Soft-launch readiness (D7-13): weekly approve/edit/block counts of the
   * assistant's replies under Require Approval, and whether it may be safe to
   * turn approval off.
   */
  readiness: scopedProcedure(RESOURCES.ASSISTANT, ACTIONS.READ)
    .input(z.object({ weeks: z.number().int().min(1).max(26).default(8) }).optional())
    .query(async ({ ctx, input }) =>
      softLaunchReadinessService.forOrganization(ctx.organizationId!, {
        weeks: input?.weeks ?? 8,
      }),
    ),

  /** Helpdesk plugins that can raise a ticket when nobody can take a hand-off. */
  ticketProviders: scopedProcedure(RESOURCES.ASSISTANT, ACTIONS.READ).query(async ({ ctx }) =>
    handoffTicketsService.listProviders(ctx.organizationId!),
  ),

  /** The ticket fields a merchant can prefill, read from their connected helpdesk account. */
  ticketForm: scopedProcedure(RESOURCES.ASSISTANT, ACTIONS.READ)
    .input(z.object({ pluginId: z.string().min(1).max(255) }))
    .query(async ({ ctx, input }) =>
      handoffTicketsService.readForm(ctx.organizationId!, input.pluginId),
    ),
});
