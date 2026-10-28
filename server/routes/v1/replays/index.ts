import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { t, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { replayService } from "@server/services/simulation/replay.service";
import { simulationHarnessService } from "@server/services/simulation/simulation-harness.service";
import { buildReplayReport } from "@server/services/simulation/replay-report";
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
          recentConversations: z.number().int().min(1).max(200).optional(),
          maxTurnsPerConversation: z.number().int().min(1).max(50).optional(),
        })
        .refine(
          (i) =>
            (i.transcriptIds?.length ?? 0) +
              (i.conversationIds?.length ?? 0) +
              (i.recentConversations ?? 0) >
            0,
          {
            message: "Pick at least one conversation to replay",
          },
        ),
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
          recentConversations: input.recentConversations ?? null,
          maxTurnsPerConversation: input.maxTurnsPerConversation ?? null,
        });
      } catch (error) {
        toTrpcError(error);
      }
    }),

  /**
   * Replay before apply (D3-17): replay the conversations behind an Insight
   * against the playbook draft that is meant to fix it, before publishing.
   */
  startForInsight: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(
      z.object({
        insightId: z.string().uuid(),
        playbookVersionOverride: playbookVersionOverrideSchema.optional(),
        label: z.string().max(255).optional(),
        maxConversations: z.number().int().min(1).max(50).default(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversationIds = await replayService.insightConversationIds(
        ctx.organizationId!,
        input.insightId,
        input.maxConversations,
      );
      if (conversationIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This insight has no conversations to replay",
        });
      }
      try {
        return await replayService.start({
          organizationId: ctx.organizationId!,
          createdById: ctx.user?.id ?? null,
          label: input.label ?? null,
          agentId: null,
          playbookVersionOverride: input.playbookVersionOverride ?? null,
          conversationIds,
          recentConversations: null,
          maxTurnsPerConversation: null,
        });
      } catch (error) {
        toTrpcError(error);
      }
    }),

  /** Buckets with examples and the sample size (D7-11). No headline %. */
  report: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.READ)
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await simulationHarnessService.getRun(ctx.organizationId!, input.runId);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      return buildReplayReport(result.run, result.items);
    }),
});
