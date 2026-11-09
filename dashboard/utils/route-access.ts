/**
 * Roles allowed on each protected route, shared by the auth middleware and the
 * client role guard. Custom menu items can register further restrictions.
 */
export const roleProtectedRoutes: Record<string, string[]> = {
  // Admin only (owner, admin)
  "/settings/users": ["owner", "admin"],
  "/settings/sso": ["owner"],
  "/settings/api-tokens": ["owner", "admin"],
  "/settings/general": ["owner", "admin"],
  "/settings/billing": ["owner", "admin"],
  "/settings/privacy": ["owner", "admin"],
  "/settings/customer-privacy": ["owner", "admin"],
  "/settings/webchat": ["owner", "admin"],
  "/settings/business-hours": ["owner", "admin"],
  "/settings/usage": ["owner", "admin"],
  "/settings/assistant": ["owner", "admin"],

  // In-app setup
  "/setup": ["owner", "admin"],

  // Insights - all except agent
  "/insights": ["owner", "admin", "contributor", "member", "viewer"],

  // Evidence packs need the conversation export scope
  "/evidence": ["owner", "admin", "contributor", "member"],

  // Content creation - contributor+
  "/playbooks/create": ["owner", "admin", "contributor"],
  "/playbooks/new": ["owner", "admin", "contributor"],

  // Document import - member+
  "/documents/import": ["owner", "admin", "contributor", "member"],

  // Plugins - admin+
  "/integrations/marketplace": ["owner", "admin"],
  "/integrations/plugins": ["owner", "admin"],
  "/plugins": ["owner", "admin"],
  "/channels": ["owner", "admin"],
};

/** Whether a role may open a path: the route itself or any route nested under it. */
export function hasRouteAccess(path: string, userRole: string | undefined): boolean {
  if (!userRole) return false;

  if (roleProtectedRoutes[path]) {
    return roleProtectedRoutes[path].includes(userRole);
  }

  for (const [protectedPath, allowedRoles] of Object.entries(roleProtectedRoutes)) {
    if (path.startsWith(`${protectedPath}/`)) {
      return allowedRoles.includes(userRole);
    }
  }

  return true;
}
