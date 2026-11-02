import { TRPCError } from "@trpc/server";
import type { AuthUser } from "@server/lib/auth/AuthUser";
import { parseScope, validateScopes } from "@server/types/scopes";

/**
 * Check that the caller may give a member (or invitee) this role and these
 * extra permissions:
 * - only an owner can make someone an owner, or change/remove an owner;
 * - extra permissions must be well-formed scopes the caller holds itself.
 */
export function assertCanGrantMembership(
  caller: AuthUser | null | undefined,
  grant: { role?: string; permissions?: string[]; currentRole?: string },
): void {
  const touchesOwner = grant.role === "owner" || grant.currentRole === "owner";
  if (touchesOwner && caller?.getRole() !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only an organization owner can grant, change or remove the owner role",
    });
  }

  if (!grant.permissions?.length) return;

  const { valid, errors } = validateScopes(grant.permissions);
  if (!valid) {
    throw new TRPCError({ code: "BAD_REQUEST", message: errors.join("; ") });
  }
  const notHeld = grant.permissions.filter((scope) => {
    const { resource, action } = parseScope(scope);
    return !caller?.hasScope(resource, action);
  });
  if (notHeld.length > 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Cannot grant permissions you don't have: ${notHeld.join(", ")}`,
    });
  }
}
