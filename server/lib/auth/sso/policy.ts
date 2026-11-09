import { TRPCError } from "@trpc/server";
import type { UserOrganization } from "@server/entities/user-organization.entity";
import { organizationEnforcesSso } from "@server/lib/auth/sso/enforcement";
import { mfaService } from "@server/services/mfa.service";

export const SSO_REQUIRED_ERROR_TYPE = "SSO_REQUIRED";
export const SSO_SESSION_SCOPE_ERROR_TYPE = "SSO_SESSION_SCOPE";

/**
 * Which sessions may act in an organization.
 *
 * - A session from single sign-on reaches only the organization whose provider
 *   signed the person in, so one provider can never reach an account's other
 *   organizations.
 * - When the organization enforces SSO, other sessions are refused. The one
 *   exception is the break-glass path: an owner with a second factor, signed
 *   in with a password, so a broken provider cannot lock the organization out.
 *
 * API keys are not people and are not affected; owners control who can create them.
 */
export async function assertSsoPolicy(
  user: { id: string; ssoOrganizationId?: string },
  membership: Pick<UserOrganization, "organizationId" | "role" | "organization">,
): Promise<void> {
  if (user.ssoOrganizationId) {
    if (user.ssoOrganizationId !== membership.organizationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This session is limited to the organization that signed you in with SSO",
        cause: { type: SSO_SESSION_SCOPE_ERROR_TYPE },
      });
    }
    return;
  }

  if (!organizationEnforcesSso(membership.organization)) return;
  if (membership.role === "owner" && (await mfaService.hasSecondFactor(user.id))) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "This organization requires single sign-on",
    cause: { type: SSO_REQUIRED_ERROR_TYPE },
  });
}
