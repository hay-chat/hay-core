import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { t, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { testCaseService } from "@server/services/simulation/test-case.service";
import { playbookVersionOverrideSchema, toTrpcError } from "../simulations";

/**
 * Test cases (D7-12): saved from replay results, approval edits/blocks and
 * feedback, and run against a playbook draft before it is published.
 */
const overridesSchema = z.object({
  title: z.string().trim().max(255).optional(),
  expectedOutcome: z.string().trim().max(4000).optional(),
  expectHandoff: z.boolean().nullable().optional(),
  mustCallTools: z.array(z.string().max(255)).max(20).optional(),
  mustNotCallTools: z.array(z.string().max(255)).max(20).optional(),
  playbookId: z.string().uuid().nullable().optional(),
});

export const testCasesRouter = t.router({
  list: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.READ)
    .input(z.object({ playbookId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) =>
      testCaseService.list(ctx.organizationId!, { playbookId: input?.playbookId }),
    ),

  createFromRunItem: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(overridesSchema.extend({ itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { itemId, ...overrides } = input;
      try {
        return await testCaseService.createFromRunItem(
          ctx.organizationId!,
          itemId,
          overrides,
          ctx.user?.id ?? null,
        );
      } catch (error) {
        toTrpcError(error);
      }
    }),

  createFromMessage: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(overridesSchema.extend({ messageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { messageId, ...overrides } = input;
      try {
        return await testCaseService.createFromMessage(
          ctx.organizationId!,
          messageId,
          overrides,
          ctx.user?.id ?? null,
        );
      } catch (error) {
        toTrpcError(error);
      }
    }),

  /** Save the conversation behind an Insight issue as a case (D3-17). */
  createFromInsightIssue: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(overridesSchema.extend({ issueId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { issueId, ...overrides } = input;
      try {
        return await testCaseService.createFromInsightIssue(
          ctx.organizationId!,
          issueId,
          overrides,
          ctx.user?.id ?? null,
        );
      } catch (error) {
        toTrpcError(error);
      }
    }),

  delete: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => ({
      deleted: await testCaseService.remove(ctx.organizationId!, input.ids),
    })),

  /** Run a playbook's cases against its draft (the publish dialog does this). */
  startRegression: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(
      z.object({
        playbookId: z.string().uuid().optional(),
        playbookVersionOverride: playbookVersionOverrideSchema.optional(),
        agentId: z.string().uuid().optional(),
        label: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        input.playbookVersionOverride &&
        input.playbookId &&
        input.playbookVersionOverride.playbookId !== input.playbookId
      ) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Draft and playbook do not match" });
      }
      try {
        return await testCaseService.startRegression({
          organizationId: ctx.organizationId!,
          createdById: ctx.user?.id ?? null,
          playbookId: input.playbookId ?? null,
          playbookVersionOverride: input.playbookVersionOverride ?? null,
          agentId: input.agentId ?? null,
          label: input.label ?? null,
        });
      } catch (error) {
        toTrpcError(error);
      }
    }),

  results: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.READ)
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        return await testCaseService.regressionResults(ctx.organizationId!, input.runId);
      } catch (error) {
        toTrpcError(error);
      }
    }),
});
