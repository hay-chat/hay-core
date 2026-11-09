import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "@server/trpc";
import { AppDataSource } from "@server/database/data-source";
import { User } from "@server/entities/user.entity";
import { verifyPassword } from "@server/lib/auth/utils/hashing";
import { authSessionService } from "@server/services/auth-session.service";
import { mfaService } from "@server/services/mfa.service";
import { protectedProcedureWithoutOrg, publicProcedure } from "@server/trpc/middleware/auth";
import { rateLimitMiddleware } from "@server/trpc/middleware/rate-limit";
import {
  PASSWORD_CHECK_RATE_LIMIT,
  completeLogin,
  requestInfo,
  requireChallengeUser,
  requireSessionUser,
} from "./shared";
import { webauthnRouter } from "./webauthn";

/** A 6-digit authenticator code or a recovery code. */
const codeSchema = z.string().trim().min(6).max(32);

export const mfaRouter = t.router({
  webauthn: webauthnRouter,

  status: protectedProcedureWithoutOrg.query(({ ctx }) => {
    return mfaService.status(requireSessionUser(ctx).id);
  }),

  /** Needs the password as well as the session. */
  beginEnrolment: protectedProcedureWithoutOrg
    .use(rateLimitMiddleware(PASSWORD_CHECK_RATE_LIMIT))
    .input(z.object({ password: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const sessionUser = requireSessionUser(ctx);
      const user = await AppDataSource.getRepository(User).findOne({
        where: { id: sessionUser.id },
      });
      if (!user || !(await verifyPassword(input.password, user.password))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Password is incorrect" });
      }
      return mfaService.beginEnrolment(user);
    }),

  /** Activates MFA and ends the account's other sessions, which only ever passed a password. */
  confirmEnrolment: protectedProcedureWithoutOrg
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireSessionUser(ctx);
      const recoveryCodes = await mfaService.confirmEnrolment(user, input.code, requestInfo(ctx));
      if (user.sessionId) {
        await authSessionService.revokeOthers(user.id, user.sessionId);
      }
      return { recoveryCodes };
    }),

  disable: protectedProcedureWithoutOrg
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      await mfaService.disable(requireSessionUser(ctx), input.code, requestInfo(ctx));
      return { success: true };
    }),

  /** With a code, or, without one, after a recent step-up (security keys have no code to type). */
  regenerateRecoveryCodes: protectedProcedureWithoutOrg
    .input(z.object({ code: codeSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const recoveryCodes = await mfaService.regenerateRecoveryCodes(
        requireSessionUser(ctx),
        input.code,
        requestInfo(ctx),
      );
      return { recoveryCodes };
    }),

  /** Second login step: trades the challenge from `auth.login` and a code for a session. */
  verifyLogin: publicProcedure
    .input(
      z.object({
        challengeToken: z.string().max(2048),
        code: codeSchema,
        useCookie: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await requireChallengeUser(input.challengeToken);

      await mfaService.verify(user, input.code, requestInfo(ctx));
      return completeLogin(user, ctx, input.useCookie);
    }),

  /** Confirm a code to perform sensitive actions from this session for a few minutes. */
  stepUp: protectedProcedureWithoutOrg
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireSessionUser(ctx);
      if (!user.sessionId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sign in again to continue" });
      }
      await mfaService.verify(user, input.code, requestInfo(ctx));
      await mfaService.grantStepUp(user.id, user.sessionId);
      return { success: true };
    }),
});
