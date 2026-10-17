import type { Organization } from "@/stores/user";
import { useExternalLink } from "@/composables/useExternalLink";

export const SUSPENDED_ROUTE = "/suspended";

/**
 * Where a suspended organization sends its users: owners and admins go to the
 * operator's redirect URL when one is configured (it can show the right
 * message and a way to restore access); everyone else gets the built-in
 * lock page. Returns true when an external redirect was issued.
 */
export async function redirectForSuspension(organization: Organization): Promise<boolean> {
  const isAdmin = organization.role === "owner" || organization.role === "admin";
  if (!organization.suspensionRedirectUrl || !isAdmin) {
    return false;
  }

  await useExternalLink().redirect(organization.suspensionRedirectUrl, {
    reason: organization.suspensionReason ?? "manual",
  });
  return true;
}
