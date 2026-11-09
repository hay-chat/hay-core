import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { t } from "@server/trpc";
import { organizationEnforcesSso } from "@server/lib/auth/sso/enforcement";
import { MFA_CHALLENGE_TTL_SECONDS, generateMfaChallengeToken } from "@server/lib/auth/utils/jwt";
import { AppDataSource } from "@server/database/data-source";
import { Organization } from "@server/entities/organization.entity";
import { mfaService } from "@server/services/mfa.service";
import { rateLimitService } from "@server/services/rate-limit.service";
import { SsoLoginError, ssoService } from "@server/services/sso.service";
import { publicProcedure } from "@server/trpc/middleware/auth";
import { completeLogin } from "./shared";

/** The public half of single sign-on: whether an address has it, and trading a ticket for a session. */
export const ssoLoginRouter = t.router({
  /** Whether this email address signs in through an identity provider. */
  discover: publicProcedure
    .input(z.object({ email: z.string().email().max(255) }))
    .query(async ({ input, ctx }) => {
      const limit = await rateLimitService.checkIpRateLimit(
        ctx.ipAddress || "unknown",
        60,
        15 * 60,
        {
          scope: "sso-discover",
          failClosed: false,
        },
      );
      if (limit.limited) return { available: false };
      return { available: !!(await ssoService.findConnectionForEmail(input.email)) };
    }),

  /** Trades the one-minute ticket from the provider's return for a session, like a password login. */
  exchange: publicProcedure
    .input(z.object({ ticket: z.string().min(16).max(256), useCookie: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      let redeemed;
      try {
        redeemed = await ssoService.redeemTicket(input.ticket);
      } catch (error) {
        if (error instanceof SsoLoginError) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Your single sign-on attempt expired. Please try again.",
            cause: { type: "SSO_TICKET_INVALID" },
          });
        }
        throw error;
      }
      const { user, organizationId } = redeemed;

      // Where SSO is enforced the provider has already asked for a second factor.
      const organization = await AppDataSource.getRepository(Organization).findOne({
        where: { id: organizationId },
        select: { id: true, settings: true },
      });
      const factors = await mfaService.factors(user.id);
      if (!organizationEnforcesSso(organization) && (factors.totp || factors.webauthn > 0)) {
        return {
          mfaRequired: true as const,
          challengeToken: generateMfaChallengeToken(user, organizationId),
          expiresIn: MFA_CHALLENGE_TTL_SECONDS,
          methods: { totp: factors.totp, webauthn: factors.webauthn > 0 },
        };
      }
      return completeLogin(user, ctx, input.useCookie, organizationId);
    }),
});
