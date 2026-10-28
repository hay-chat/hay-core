import { TRPCError } from "@trpc/server";
import type { Organization } from "@server/entities/organization.entity";

/**
 * Procedure paths that keep working while an organization is suspended, so the
 * dashboard can still show the lock page, send the owner to the external
 * billing page, switch to another organization or log out. The workspace
 * export stays open too: a locked or cancelled owner can take their data out
 * until the day-90 purge (D15-7).
 */
export const SUSPENSION_EXEMPT_PREFIXES = ["auth.", "internal.", "organizationExport."];
export const SUSPENSION_EXEMPT_PATHS = new Set([
  "organizations.switchOrganization",
  "organizations.getSettings",
  "organizations.delete",
  "plugins.getMenuItems",
]);

export const ORGANIZATION_SUSPENDED_ERROR_TYPE = "ORGANIZATION_SUSPENDED";

export function isSuspensionExempt(path: string): boolean {
  if (SUSPENSION_EXEMPT_PATHS.has(path)) {
    return true;
  }
  return SUSPENSION_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Throw FORBIDDEN when the organization is suspended and the procedure is not
 * exempt. The error message deliberately avoids words like "unauthorized" so the
 * dashboard's logout heuristics never mistake a suspension for an auth failure.
 */
export function assertOrganizationNotSuspended(
  organization: Pick<Organization, "suspendedAt" | "suspensionReason"> | undefined | null,
  path: string,
): void {
  if (!organization?.suspendedAt || isSuspensionExempt(path)) {
    return;
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Organization is suspended",
    cause: {
      type: ORGANIZATION_SUSPENDED_ERROR_TYPE,
      reason: organization.suspensionReason ?? null,
    },
  });
}
