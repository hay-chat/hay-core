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

const notImplemented = (): never => {
  throw new TRPCError({ code: "METHOD_NOT_SUPPORTED", message: "Not implemented yet" });
};

const read = () => scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.READ);
const update = () => scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE);

export const setupRouter = t.router({
  /** Answers plus the live status of every row. Never runs an LLM check. */
  get: read().query((): Promise<SetupBoard> => notImplemented()),

  suggestions: read()
    .input(z.object({ businessType: z.enum(BUSINESS_TYPES) }))
    .query((): Promise<SetupSuggestions> => notImplemented()),

  /** Guesses the business type from the website. Null when the site can't be read. */
  inferBusinessType: update()
    .input(z.object({ website: z.string().trim().min(1).max(2048) }))
    .mutation((): Promise<{ businessType: BusinessType | null }> => notImplemented()),

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
    .mutation((): Promise<SetupBoard> => notImplemented()),

  /** Runs the readiness check. Omit `questionIds` to check everything that needs it. */
  checkQuestions: update()
    .input(z.object({ questionIds: z.array(z.string().min(1).max(255)).max(30).optional() }))
    .mutation((): Promise<SetupBoard> => notImplemented()),

  /** Saves the customer's own answer as a document, then rechecks that question. */
  addAnswer: update()
    .input(
      z.object({
        questionId: z.string().min(1).max(255),
        answer: z.string().trim().min(1).max(10000),
      }),
    )
    .mutation((): Promise<SetupBoard> => notImplemented()),

  addQuestion: update()
    .input(z.object({ text: z.string().trim().min(1).max(500) }))
    .mutation((): Promise<SetupBoard> => notImplemented()),

  removeQuestion: update()
    .input(z.object({ questionId: z.string().min(1).max(255) }))
    .mutation((): Promise<SetupBoard> => notImplemented()),

  /** "Finish later": stops the redirect from `/`. Setup stays available in the sidebar. */
  dismiss: update().mutation((): Promise<SetupBoard> => notImplemented()),
});
