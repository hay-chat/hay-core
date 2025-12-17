/**
 * Role-based route guard plugin
 * Checks user permissions after navigation and redirects if unauthorized
 */

import { useUserStore } from "@/stores/user";
import { useAuthStore } from "@/stores/auth";

export default defineNuxtPlugin(() => {
  const userStore = useUserStore();
  const authStore = useAuthStore();
  const router = useRouter();

  // Define role-protected routes (same as middleware)
  const roleProtectedRoutes: Record<string, string[]> = {
    // Admin only (owner, admin)
    "/settings/users": ["owner", "admin"],
    "/settings/api-tokens": ["owner", "admin"],
    "/settings/general": ["owner", "admin"],
    "/settings/billing": ["owner", "admin"],
    "/settings/privacy": ["owner", "admin"],
    "/settings/webchat": ["owner", "admin"],
    "/agents": ["owner", "admin"],

    // Analytics - all except agent
    "/analytics": ["owner", "admin", "contributor", "member", "viewer"],
    "/analytics/reports": ["owner", "admin", "contributor", "member", "viewer"],
    "/insights": ["owner", "admin", "contributor", "member", "viewer"],

    // Content creation - contributor+
    "/agents/create": ["owner", "admin", "contributor"],
    "/agents/new": ["owner", "admin", "contributor"],
    "/playbooks/create": ["owner", "admin", "contributor"],
    "/playbooks/new": ["owner", "admin", "contributor"],

    // Document import - member+
    "/documents/import": ["owner", "admin", "contributor", "member"],

    // Plugins - admin+
    "/integrations/marketplace": ["owner", "admin"],
    "/integrations/plugins": ["owner", "admin"],
    "/plugins": ["owner", "admin"],
  };

  /**
   * Check if a user role has access to a specific route
   */
  function hasRouteAccess(path: string, userRole: string | undefined): boolean {
    if (!userRole) return false;

    // Check if this specific route is protected
    if (roleProtectedRoutes[path]) {
      return roleProtectedRoutes[path].includes(userRole);
    }

    // Check if any parent route matches (for dynamic routes)
    for (const [protectedPath, allowedRoles] of Object.entries(roleProtectedRoutes)) {
      if (path.startsWith(protectedPath)) {
        return allowedRoles.includes(userRole);
      }
    }

    // If route is not explicitly protected, allow access
    return true;
  }

  // Add router guard that runs after each navigation
  router.afterEach((to, from) => {
    // Skip if not authenticated
    if (!authStore.isAuthenticated || !userStore.user?.id) {
      return;
    }

    // Skip public pages
    if (to.meta.public === true) {
      return;
    }

    // Skip unauthorized page itself
    if (to.path === "/unauthorized") {
      return;
    }

    // Check role-based access
    const currentOrganization = userStore.currentOrganization;
    const userRole = currentOrganization?.role;

    console.log("[Role Guard Plugin] Checking access to:", to.path, "Role:", userRole);

    if (!hasRouteAccess(to.path, userRole)) {
      console.warn(`[Role Guard Plugin] Access denied to ${to.path} for role: ${userRole}`);

      // Redirect to unauthorized page
      router.push({
        path: "/unauthorized",
        query: { from: to.path },
      });
    }
  });
});
