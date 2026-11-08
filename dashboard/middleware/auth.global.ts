import { logger } from "@/utils/logger";
import type { RouteLocationNormalized } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useUserStore, type User } from "@/stores/user";
import { redirectForSuspension, SUSPENDED_ROUTE } from "@/composables/useSuspension";
import { HayAuthApi } from "@/utils/api";

// Define role-protected routes
// Map route paths to required roles
// Exported so custom menu items can register dynamic role restrictions
export const roleProtectedRoutes: Record<string, string[]> = {
  // Admin only (owner, admin)
  "/settings/users": ["owner", "admin"],
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

/**
 * Check if a user role has access to a specific route
 */
export function hasRouteAccess(path: string, userRole: string | undefined): boolean {
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

export default defineNuxtRouteMiddleware(
  async (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
    logger.debug("[Auth Middleware] Checking route:", to.path, "process.client:", process.client);

    // Alert links (push, email) carry ?org=<id>: open them in that organization
    // for users who belong to several. Before the same-page check, which also
    // matches the first load.
    if (process.client && typeof to.query.org === "string") {
      const userStore = useUserStore();
      if (
        to.query.org !== userStore.activeOrganizationId &&
        userStore.organizations.some((org) => org.id === to.query.org)
      ) {
        await userStore.switchOrganization(to.query.org);
      }
    }

    // Skip auth check if staying on the same page (e.g., opening modals)
    if (to.path === from.path) {
      logger.debug("[Auth Middleware] Same page, skipping");
      return;
    }

    // Check if the page is marked as public via page metadata
    if (to.meta.public === true) {
      logger.debug("[Auth Middleware] Public page detected:", to.path);
      return;
    }

    // Only run on client side - SSR doesn't have access to stores properly
    if (!process.client) {
      logger.debug("[Auth Middleware] Running on server side, skipping role check");
      return;
    }

    const authStore = useAuthStore();
    const userStore = useUserStore();

    // Check if auth is still initializing - only on client side
    if (!authStore.isInitialized) {
      // For client-side navigation, wait for auth initialization
      // but immediately redirect if we know there's no token
      if (!authStore.tokens?.accessToken) {
        logger.debug("[Auth Middleware] No token and not initialized, redirecting to login");
        return navigateTo({ path: "/login", query: { redirect: to.fullPath } });
      }
      logger.debug("[Auth Middleware] Auth not initialized yet but has token, waiting");
      return; // Let AuthProvider handle the loading state
    }

    // Check authentication status and user data presence
    const hasValidAuth = authStore.isAuthenticated && userStore.user?.id;

    if (!hasValidAuth) {
      // If authenticated but missing user data, clear auth state
      if (authStore.isAuthenticated && !userStore.user?.id) {
        logger.debug("[Auth Middleware] Authenticated but missing user data, logging out");
        authStore.logout();
        return;
      }

      return navigateTo({ path: "/login", query: { redirect: to.fullPath } });
    }

    // Suspended organization: owners/admins may be sent to the operator's page,
    // everyone else is locked to /suspended until access is restored.
    let currentOrganization = userStore.currentOrganization;
    if (currentOrganization?.suspendedAt && to.path !== SUSPENDED_ROUTE) {
      // The store is persisted, so confirm with the server before locking anyone
      // out: a suspension lifted since the last visit must not bounce the user.
      try {
        const user = await HayAuthApi.auth.me.query();
        userStore.setUser(user as User);
        currentOrganization = userStore.currentOrganization;
      } catch (error) {
        console.warn("[Auth Middleware] Could not refresh access state:", error);
      }
    }
    if (currentOrganization?.suspendedAt) {
      if (to.path === SUSPENDED_ROUTE) {
        return;
      }
      if (await redirectForSuspension(currentOrganization)) {
        return abortNavigation();
      }
      return navigateTo(SUSPENDED_ROUTE);
    }
    if (to.path === SUSPENDED_ROUTE) {
      return navigateTo("/");
    }

    // Role-based route protection
    const userRole = currentOrganization?.role;

    logger.debug("[Auth Middleware] User role:", userRole);
    logger.debug("[Auth Middleware] Has access:", hasRouteAccess(to.path, userRole));

    if (!hasRouteAccess(to.path, userRole)) {
      console.warn(`[Auth Middleware] Access denied to ${to.path} for role: ${userRole}`);

      // Prevent navigation to unauthorized page itself
      if (to.path === "/unauthorized") {
        return;
      }

      // Redirect to unauthorized page with the attempted path
      logger.debug("[Auth Middleware] Redirecting to unauthorized page");
      return navigateTo("/unauthorized?from=" + encodeURIComponent(to.path));
    }

    logger.debug("[Auth Middleware] Access granted");
  },
);
