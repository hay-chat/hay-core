import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import {
  BUSINESS_TYPES,
  type BusinessType,
  type SetupBoard,
  type SetupSuggestions,
} from "@server/types/setup.types";
import * as setup from "@server/services/setup/setup.service";

const read = () => scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.READ);
const update = () => scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE);

const orgId = (ctx: { organizationId?: string | null }): string => {
  if (!ctx.organizationId) throw new TRPCError({ code: "BAD_REQUEST", message: "No organization" });
  return ctx.organizationId;
};

export const setupRouter = t.router({
  /** Answers plus the live status of every row. Never runs an LLM check. */
  get: read().query(({ ctx }): Promise<SetupBoard> => setup.getBoard(orgId(ctx))),

  suggestions: read()
    .input(z.object({ businessType: z.enum(BUSINESS_TYPES) }))
    .query(({ ctx, input }): Promise<SetupSuggestions> =>
      setup.getSuggestions(orgId(ctx), input.businessType),
    ),

  /** Guesses the business type from the website. Null when the site can't be read. */
  inferBusinessType: update()
    .input(z.object({ website: z.string().trim().min(1).max(2048) }))
    .mutation(async ({ ctx, input }): Promise<{ businessType: BusinessType | null }> => ({
      businessType: await setup.inferBusinessType(orgId(ctx), input.website),
    })),

  /** Saves answers and starts reading the site. Keeps checks and playbooks of unchanged questions. */
  saveAnswers: update()
    .input(
      z.object({
        businessType: z.enum(BUSINESS_TYPES),
        website: z.string().trim().max(2048).optional(),
        toolPluginIds: z.array(z.string().min(1).max(255)).max(50),
        channels: z.array(z.string().min(1).max(255)).max(20),
        questions: z
          .array(
            z.object({
              /** Catalog or existing question id. Omitted for a new custom question. */
              id: z.string().min(1).max(255).optional(),
              text: z.string().trim().min(1).max(500),
            }),
          )
          .max(30),
      }),
    )
    .mutation(({ ctx, input }): Promise<SetupBoard> => setup.saveAnswers(orgId(ctx), input)),

  /** Runs the readiness check. Omit `questionIds` to check everything that needs it. */
  checkQuestions: update()
    .input(z.object({ questionIds: z.array(z.string().min(1).max(255)).max(30).optional() }))
    .mutation(({ ctx, input }): Promise<SetupBoard> =>
      setup.checkQuestions(orgId(ctx), input.questionIds),
    ),

  /** Saves the customer's own answer as a document, then rechecks that question. */
  addAnswer: update()
    .input(
      z.object({
        questionId: z.string().min(1).max(255),
        answer: z.string().trim().min(1).max(10000),
      }),
    )
    .mutation(({ ctx, input }): Promise<SetupBoard> =>
      setup.addAnswer(orgId(ctx), input.questionId, input.answer),
    ),

  addQuestion: update()
    .input(z.object({ text: z.string().trim().min(1).max(500) }))
    .mutation(({ ctx, input }): Promise<SetupBoard> => setup.addQuestion(orgId(ctx), input.text)),

  removeQuestion: update()
    .input(z.object({ questionId: z.string().min(1).max(255) }))
    .mutation(({ ctx, input }): Promise<SetupBoard> =>
      setup.removeQuestion(orgId(ctx), input.questionId),
    ),

  /**
   * Drafts a playbook for each connected platform request that has none. Naming `questionIds`
   * retries a request whose earlier attempt found no suitable tool or failed.
   */
  generatePlaybooks: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.CREATE)
    .input(z.object({ questionIds: z.array(z.string().min(1).max(255)).max(30).optional() }))
    .mutation(({ ctx, input }): Promise<SetupBoard> =>
      setup.generatePlaybooks(orgId(ctx), input.questionIds),
    ),

  /** Turns on a request's draft playbook. Safe to call twice. */
  turnOnPlaybook: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(z.object({ questionId: z.string().min(1).max(255) }))
    .mutation(({ ctx, input }): Promise<SetupBoard> =>
      setup.turnOn(orgId(ctx), ctx.user!.id, input.questionId),
    ),

  /** "Finish later": stops the redirect from `/`. Setup stays available in the sidebar. */
  dismiss: update().mutation(({ ctx }): Promise<SetupBoard> => setup.dismiss(orgId(ctx))),
});
