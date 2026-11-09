import { z } from "zod";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { t } from "@server/trpc";
import { authSessionService } from "@server/services/auth-session.service";
import { mfaService } from "@server/services/mfa.service";
import { webauthnService } from "@server/services/webauthn.service";
import { protectedProcedureWithoutOrg, publicProcedure } from "@server/trpc/middleware/auth";
import { rateLimitMiddleware } from "@server/trpc/middleware/rate-limit";
import { TRPCError } from "@trpc/server";
import {
  PASSWORD_CHECK_RATE_LIMIT,
  challengeSsoOrganizationId,
  completeLogin,
  requestInfo,
  requireChallengeUser,
  requireSessionUser,
} from "./shared";

const base64url = z.string().max(4096);
const clientExtensionResults = z.record(z.string(), z.unknown());
const authenticatorAttachment = z.enum(["platform", "cross-platform"]).optional();

/** What `navigator.credentials.create()` returns, as the browser package serializes it. */
const registrationResponseShape = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url,
    attestationObject: z.string().max(65536),
    authenticatorData: base64url.optional(),
    transports: z.array(z.string().max(32)).max(10).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: base64url.optional(),
  }),
  authenticatorAttachment,
  clientExtensionResults,
});

/** What `navigator.credentials.get()` returns, as the browser package serializes it. */
const authenticationResponseShape = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
    userHandle: base64url.optional(),
  }),
  authenticatorAttachment,
  clientExtensionResults,
});

// Checked against the shape above, typed as the library's own response type.
const registrationResponseSchema = z.custom<RegistrationResponseJSON>(
  (value) => registrationResponseShape.safeParse(value).success,
);
const authenticationResponseSchema = z.custom<AuthenticationResponseJSON>(
  (value) => authenticationResponseShape.safeParse(value).success,
);

const nameSchema = z.string().trim().min(1).max(100);

function requireStepUpSession(ctx: Parameters<typeof requireSessionUser>[0]) {
  const user = requireSessionUser(ctx);
  if (!user.sessionId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sign in again to continue" });
  }
  return { user, sessionId: user.sessionId };
}

/** Security keys and passkeys as a second factor, beside the authenticator app. */
export const webauthnRouter = t.router({
  list: protectedProcedureWithoutOrg.query(({ ctx }) => {
    return webauthnService.list(requireSessionUser(ctx).id);
  }),

  /** Needs the password for the first factor, a recent step-up for later ones. */
  registrationOptions: protectedProcedureWithoutOrg
    .use(rateLimitMiddleware(PASSWORD_CHECK_RATE_LIMIT))
    .input(z.object({ password: z.string().min(1).max(128).optional() }))
    .mutation(({ ctx, input }) => {
      return webauthnService.registrationOptions(requireSessionUser(ctx), input.password);
    }),

  /** A first factor ends the account's other sessions, which only ever passed a password. */
  verifyRegistration: protectedProcedureWithoutOrg
    .input(z.object({ response: registrationResponseSchema, name: nameSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const user = requireSessionUser(ctx);
      const result = await webauthnService.verifyRegistration(
        user,
        input.response,
        input.name,
        requestInfo(ctx),
      );
      if (result.recoveryCodes && user.sessionId) {
        await authSessionService.revokeOthers(user.id, user.sessionId);
      }
      return result;
    }),

  rename: protectedProcedureWithoutOrg
    .input(z.object({ id: z.string().uuid(), name: nameSchema }))
    .mutation(async ({ ctx, input }) => {
      await webauthnService.rename(requireSessionUser(ctx).id, input.id, input.name);
      return { success: true };
    }),

  remove: protectedProcedureWithoutOrg
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await webauthnService.remove(requireSessionUser(ctx), input.id, requestInfo(ctx));
      return { success: true };
    }),

  /** Second login step, with a key instead of a code. */
  loginOptions: publicProcedure
    .input(z.object({ challengeToken: z.string().max(2048) }))
    .mutation(async ({ input }) => {
      const user = await requireChallengeUser(input.challengeToken);
      return webauthnService.authenticationOptions(user.id, { purpose: "login" });
    }),

  verifyLogin: publicProcedure
    .input(
      z.object({
        challengeToken: z.string().max(2048),
        response: authenticationResponseSchema,
        useCookie: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await requireChallengeUser(input.challengeToken);
      await webauthnService.verifyAuthentication(
        user,
        { purpose: "login" },
        input.response,
        requestInfo(ctx),
      );
      return completeLogin(
        user,
        ctx,
        input.useCookie,
        challengeSsoOrganizationId(input.challengeToken),
      );
    }),

  stepUpOptions: protectedProcedureWithoutOrg.mutation(({ ctx }) => {
    const { user, sessionId } = requireStepUpSession(ctx);
    return webauthnService.authenticationOptions(user.id, { purpose: "stepup", sessionId });
  }),

  stepUp: protectedProcedureWithoutOrg
    .input(z.object({ response: authenticationResponseSchema }))
    .mutation(async ({ ctx, input }) => {
      const { user, sessionId } = requireStepUpSession(ctx);
      await webauthnService.verifyAuthentication(
        user,
        { purpose: "stepup", sessionId },
        input.response,
        requestInfo(ctx),
      );
      await mfaService.grantStepUp(user.id, sessionId);
      return { success: true };
    }),
});
