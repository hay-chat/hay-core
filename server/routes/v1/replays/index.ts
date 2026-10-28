import { z } from "zod";
import { t, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { replayService } from "@server/services/simulation/replay.service";
import { playbookVersionOverrideSchema, toTrpcError } from "../simulations";

/**
 * Replays (D7-9): past conversations (imported transcripts or Hay.chat's own)
 * replayed one customer turn at a time against the agent, in dry run. Free,
 * never billed, counted against the monthly simulation allowance.
 */
export const replaysRouter = t.router({
  start: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(
      z
        .object({
          label: z.string().max(255).optional(),
          agentId: z.string().uuid().optional(),
          playbookVersionOverride: playbookVersionOverrideSchema.optional(),
          transcriptIds: z.array(z.string().uuid()).max(200).optional(),
          conversationIds: z.array(z.string().uuid()).max(200).optional(),
          maxTurnsPerConversation: z.number().int().min(1).max(50).optional(),
        })
        .refine((i) => (i.transcriptIds?.length ?? 0) + (i.conversationIds?.length ?? 0) > 0, {
          message: "Pick at least one conversation to replay",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await replayService.start({
          organizationId: ctx.organizationId!,
          createdById: ctx.user?.id ?? null,
          label: input.label ?? null,
          agentId: input.agentId ?? null,
          playbookVersionOverride: input.playbookVersionOverride ?? null,
          transcriptIds: input.transcriptIds,
          conversationIds: input.conversationIds,
          maxTurnsPerConversation: input.maxTurnsPerConversation ?? null,
        });
      } catch (error) {
        toTrpcError(error);
      }
    }),
});
