import { rateLimitMiddleware, RateLimits } from "@server/trpc/middleware/rate-limit";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import {
  BUSINESS_TYPES,
  type BusinessType,
  type SetupAnswerText,
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

  /**
   * Starts reading the website while the first question is open. Idempotent for one address;
   * a bad address does not throw, it shows as `site.state === "failed"`.
   */
  startReading: update()
    .input(z.object({ website: z.string().trim().min(1).max(2048) }))
    .mutation(({ ctx, input }): Promise<SetupBoard> =>
      setup.startReading(orgId(ctx), input.website),
    ),

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

  /**
   * Saves a row's edit panel: its wording, its own answer and the document that answer is based
   * on. Omitted fields stay as they are; `linkedDocumentId: null` drops the link. Rechecks once.
   */
  updateQuestion: update()
    .input(
      z.object({
        questionId: z.string().min(1).max(255),
        text: z.string().trim().min(1).max(500).optional(),
        answer: z.string().trim().min(1).max(10000).optional(),
        linkedDocumentId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }): Promise<SetupBoard> => setup.updateQuestion(orgId(ctx), input)),

  /** Drafts an answer from one document. `answer` is null when it does not state the fact. */
  draftAnswer: update()
    .use(rateLimitMiddleware(RateLimits.MODERATE))
    .input(z.object({ questionId: z.string().min(1).max(255), documentId: z.string().uuid() }))
    .mutation(({ ctx, input }): Promise<{ answer: string | null }> =>
      setup.draftAnswer(orgId(ctx), input.questionId, input.documentId),
    ),

  /** The current text of a row's own answer, or null when it has none or it was deleted. */
  getAnswer: read()
    .input(z.object({ questionId: z.string().min(1).max(255) }))
    .query(({ ctx, input }): Promise<SetupAnswerText | null> =>
      setup.getAnswer(orgId(ctx), input.questionId),
    ),

  addQuestion: update()
    .input(z.object({ text: z.string().trim().min(1).max(500) }))
    .mutation(({ ctx, input }): Promise<SetupBoard> => setup.addQuestion(orgId(ctx), input.text)),

  removeQuestion: update()
    .input(z.object({ questionId: z.string().min(1).max(255) }))
    .mutation(({ ctx, input }): Promise<SetupBoard> =>
      setup.removeQuestion(orgId(ctx), input.questionId),
    ),

  /** Undoes a removal: same position, status, answer and playbook, with no recheck. */
  restoreQuestion: update()
    .input(z.object({ questionId: z.string().min(1).max(255) }))
    .mutation(({ ctx, input }): Promise<SetupBoard> =>
      setup.restoreQuestion(orgId(ctx), input.questionId),
    ),

  /**
   * Drafts a playbook for each connected platform request that has none. Naming `questionIds`
   * retries a request whose earlier attempt found no suitable tool or failed.
   */
  generatePlaybooks: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.CREATE)
    .use(rateLimitMiddleware(RateLimits.MODERATE))
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
