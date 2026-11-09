import { t } from "@server/trpc/init";
import { TRPCError } from "@trpc/server";
import { mfaService } from "@server/services/mfa.service";

/** Procedures an unenrolled person still needs in order to reach the enrolment page and enrol. */
const MFA_ENROLMENT_EXEMPT_PREFIXES = ["auth.", "internal."];
const MFA_ENROLMENT_EXEMPT_PATHS = new Set([
  "organizations.switchOrganization",
  "organizations.getSettings",
  "plugins.getMenuItems",
]);

export function isMfaEnrolmentExempt(path: string): boolean {
  return (
    MFA_ENROLMENT_EXEMPT_PATHS.has(path) ||
    MFA_ENROLMENT_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

/** Sensitive actions need a recent second-factor check from people who have MFA. */
export const requireMfaStepUp = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
  }
  await mfaService.assertStepUp(ctx.user);
  return next();
});
