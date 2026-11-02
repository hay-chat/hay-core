import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "@server/trpc/init";
import { internalProcedure } from "@server/trpc/middleware/internal";
import { AppDataSource } from "@server/database/data-source";
import { User } from "@server/entities/user.entity";
import { authSessionService } from "@server/services/auth-session.service";
import { enableDefaultPlugins } from "@server/services/default-plugins.service";
import {
  createAccount,
  issueSignupVerificationToken,
} from "@server/services/account-registration.service";

/**
 * Account provisioning for the operator's onboarding service. Unlike the public
 * auth.register, this returns a session right away (the operator configures the
 * new organization with it before the user has verified their email) and may
 * create the account already verified when the operator verified the email itself.
 */
export const internalUsersRouter = router({
  register: internalProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8).max(128),
        firstName: z.string().max(255).optional(),
        lastName: z.string().max(255).optional(),
        organizationName: z.string().min(1).max(255),
        emailVerified: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await AppDataSource.getRepository(User).findOne({
        where: { email: input.email.toLowerCase() },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Email is already registered" });
      }

      const { user, organization, tokens } = await AppDataSource.transaction(async (manager) => {
        const account = await createAccount(manager, input);
        const tokens = await authSessionService.createSession(account.user, ctx, manager);
        return { ...account, tokens };
      });

      if (organization) void enableDefaultPlugins(organization.id);

      return {
        user: {
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
          activeOrganizationId: organization?.id,
        },
        ...tokens,
      };
    }),

  /**
   * A fresh signup verification token, for the operator to email in its own
   * template. The token is never handed to the user's own session.
   */
  createEmailVerificationToken: internalProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const user = await AppDataSource.getRepository(User).findOne({
        where: { id: input.userId },
      });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      if (user.emailVerified) {
        return { token: null, expiresAt: null };
      }

      const token = await issueSignupVerificationToken(user);
      return { token, expiresAt: user.emailVerificationExpiresAt?.toISOString() ?? null };
    }),
});
