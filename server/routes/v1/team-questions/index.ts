import { t, scopedProcedure, publicProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { TeamQuestion } from "@server/database/entities/team-question.entity";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { organizationRepository } from "@server/repositories/organization.repository";
import {
  QUICK_CHECK_MINUTES_LIMITS,
  resolveQuickCheckSettings,
} from "@server/types/organization-settings.types";
import {
  MAX_ANSWER_LENGTH,
  TEAM_QUESTION_TEXT_FIELDS,
  teamQuestionService,
} from "@server/services/team-questions/team-question.service";
import { verifyAnswerToken } from "@server/services/team-questions/answer-token";
import { LANGUAGE_CODES, isLanguageCode } from "@server/types/language.types";
import { userRepository } from "@server/repositories/user.repository";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("team-questions-route");

/**
 * Quick check with the team (D19): the questions the AI asked the team, the
 * answer box (Inbox and the signed email link), and the per-org setting.
 */

const answerInput = {
  answer: z.string().trim().min(1).max(MAX_ANSWER_LENGTH),
  /** "Send as written"; off = the AI rephrases it (Roger, D19 answer 4). */
  sendAsWritten: z.boolean().default(false),
  /** Off = a one-off answer, never saved to knowledge (D19-7). */
  saveToKnowledge: z.boolean().default(true),
};

const minutes = z
  .number()
  .int()
  .min(QUICK_CHECK_MINUTES_LIMITS.min)
  .max(QUICK_CHECK_MINUTES_LIMITS.max);

/** The question behind an emailed answer link, if the link is valid and its teammate still a member. */
async function questionForToken(token: string) {
  const claims = verifyAnswerToken(token);
  if (!claims) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "This link is invalid or expired." });
  }
  const question = await AppDataSource.getRepository(TeamQuestion).findOneBy({
    id: claims.questionId,
  });
  if (!question) {
    throw new TRPCError({ code: "NOT_FOUND", message: "This question no longer exists." });
  }
  const membership: Array<{ ok: number }> = await AppDataSource.query(
    `SELECT 1 AS ok
       FROM user_organizations uo
       JOIN users u ON u.id = uo.user_id
      WHERE uo.user_id = $1 AND uo.organization_id = $2
        AND uo.is_active = true AND u.is_active = true`,
    [claims.userId, question.organizationId],
  );
  if (membership.length === 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This link is no longer valid." });
  }
  return { question, userId: claims.userId };
}

/**
 * The question in the translation language of the teammate an answer link
 * was sent to. Null when they have none, or the translation failed (the page
 * shows the original).
 */
async function translationForLinkReader(
  questionId: string,
  organizationId: string,
  userId: string,
) {
  try {
    const user = await userRepository.findById(userId);
    const language = user?.translationLanguage;
    if (!isLanguageCode(language)) return null;
    const [translation] = await teamQuestionService.translateForReader({
      organizationId,
      questionIds: [questionId],
      language,
    });
    return translation ?? null;
  } catch (error) {
    logger.warn({ err: error, questionId }, "Could not translate the question for its link");
    return null;
  }
}

/** A translation's text, or null when there is none or it is the original. */
function differentText(translation: { source: string; text: string } | null | undefined) {
  return translation && translation.text !== translation.source ? translation.text : null;
}

export const teamQuestionsRouter = t.router({
  /** Questions the team can still answer (Inbox "Questions" card). */
  list: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ).query(async ({ ctx }) => {
    return teamQuestionService.listAnswerable(ctx.organizationId!);
  }),

  /** The listed questions in the reader's translation language (translated once, cached). */
  translate: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
    .input(
      z.object({
        questionIds: z.array(z.string().uuid()).min(1).max(100),
        language: z.enum(LANGUAGE_CODES),
        fields: z
          .array(z.enum(TEAM_QUESTION_TEXT_FIELDS))
          .min(1)
          .default([...TEAM_QUESTION_TEXT_FIELDS]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await teamQuestionService.translateForReader({
          organizationId: ctx.organizationId!,
          questionIds: [...new Set(input.questionIds)],
          language: input.language,
          fields: input.fields,
        });
      } catch (error) {
        logger.error({ err: error, language: input.language }, "Team question translation failed");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "TRANSLATION_FAILED" });
      }
    }),

  answer: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(z.object({ questionId: z.string().uuid(), ...answerInput }))
    .mutation(async ({ ctx, input }) => {
      return teamQuestionService.answer({
        questionId: input.questionId,
        organizationId: ctx.organizationId!,
        userId: ctx.user!.id,
        answer: input.answer,
        relayMode: input.sendAsWritten ? "verbatim" : "rephrase",
        saveToKnowledge: input.saveToKnowledge,
      });
    }),

  dismiss: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(z.object({ questionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await teamQuestionService.dismiss(input.questionId, ctx.organizationId!, ctx.user!.id);
      return { ok: true };
    }),

  getSettings: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.READ).query(
    async ({ ctx }) => {
      const organization = await organizationRepository.findById(ctx.organizationId!);
      return resolveQuickCheckSettings(organization?.settings);
    },
  ),

  updateSettings: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE)
    .input(
      z
        .object({
          enabled: z.boolean(),
          updateAfterMinutes: minutes,
          giveUpAfterMinutes: minutes,
        })
        .refine((value) => value.updateAfterMinutes < value.giveUpAfterMinutes, {
          message: "The update must come before the wait ends.",
          path: ["updateAfterMinutes"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const organization = await organizationRepository.findById(ctx.organizationId!);
      if (!organization) throw new TRPCError({ code: "NOT_FOUND" });
      await organizationRepository.update(organization.id, {
        settings: { ...(organization.settings || {}), quickCheck: input },
      });
      return resolveQuickCheckSettings({ quickCheck: input });
    }),

  /** The one-field answer page behind the team email link (no login). */
  byToken: publicProcedure
    .input(z.object({ token: z.string().min(10).max(512) }))
    .query(async ({ input }) => {
      const { question, userId } = await questionForToken(input.token);
      const [organization, translation] = await Promise.all([
        organizationRepository.findById(question.organizationId),
        translationForLinkReader(question.id, question.organizationId, userId),
      ]);
      return {
        organizationName: organization?.name ?? null,
        question: question.question,
        customerMessage: question.customerMessage,
        /** In the teammate's translation language, when they have one and it differs. */
        translatedQuestion: differentText(translation?.question),
        translatedCustomerMessage: differentText(translation?.customerMessage),
        askedAt: question.askedAt.toISOString(),
        answerable: question.status === "open" || question.status === "timed_out",
        status: question.status,
      };
    }),

  answerByToken: publicProcedure
    .input(z.object({ token: z.string().min(10).max(512), ...answerInput }))
    .mutation(async ({ input }) => {
      const { question, userId } = await questionForToken(input.token);
      return teamQuestionService.answer({
        questionId: question.id,
        organizationId: question.organizationId,
        userId,
        answer: input.answer,
        relayMode: input.sendAsWritten ? "verbatim" : "rephrase",
        saveToKnowledge: input.saveToKnowledge,
      });
    }),
});
