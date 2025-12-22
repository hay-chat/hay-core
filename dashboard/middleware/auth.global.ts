import type { RouteLocationNormalized } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";

// Define role-protected routes
// Map route paths to required roles
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

export default defineNuxtRouteMiddleware(
  async (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
    console.log("[Auth Middleware] Checking route:", to.path, "process.client:", process.client);

    // Skip auth check if staying on the same page (e.g., opening modals)
    // UNLESS we have URL tokens (for E2E testing)
    const hasUrlTokens = to.query.accessToken && to.query.refreshToken && to.query.expiresIn;
    if (to.path === from.path && !hasUrlTokens) {
      console.log("[Auth Middleware] Same page, skipping");
      return;
    }

    // Check if the page is marked as public via page metadata
    if (to.meta.public === true) {
      console.log("[Auth Middleware] Public page detected:", to.path);
      return;
    }

    // Allow test pages without auth
    if (to.path.startsWith("/test/")) {
      console.log("[Auth Middleware] Test page detected:", to.path);
      return;
    }

    // Only run on client side - SSR doesn't have access to stores properly
    if (!process.client) {
      console.log("[Auth Middleware] Running on server side, skipping role check");
      return;
    }

    const authStore = useAuthStore();
    const userStore = useUserStore();

    // URL Token Auth for E2E Testing (Development Only)
    if (
      process.client &&
      process.env.NODE_ENV !== "production" &&
      to.query.accessToken &&
      to.query.refreshToken &&
      to.query.expiresIn
    ) {
      console.log("[Auth Middleware] 🔐 URL token authentication detected (E2E testing mode)");

      const accessToken = to.query.accessToken as string;
      const refreshToken = to.query.refreshToken as string;
      const expiresIn = parseInt(to.query.expiresIn as string, 10);

      try {
        await authStore.loginWithTokens({
          accessToken,
          refreshToken,
          expiresIn,
        });

        console.log("[Auth Middleware] ✅ URL token validated successfully");
        console.log(
          "[Auth Middleware] ⚠️  Warning: URL token auth is for development/testing only!",
        );

        // Mark that we just did URL token auth to prevent AuthProvider from redirecting
        if (process.client) {
          sessionStorage.setItem("urlTokenAuthCompleted", "true");
        }

        // Clean URL by removing tokens and navigating with replace
        const cleanQuery = { ...to.query };
        delete cleanQuery.accessToken;
        delete cleanQuery.refreshToken;
        delete cleanQuery.expiresIn;

        // Navigate to the same path with clean query params
        return navigateTo({ path: to.path, query: cleanQuery }, { replace: true });
      } catch (error) {
        console.error("[Auth Middleware] ❌ URL token validation failed:", error);

        // Clear invalid auth state
        authStore.tokens = null;
        authStore.isAuthenticated = false;

        // Show error to user
        if (process.client) {
          const { $toast } = useNuxtApp() as {
            $toast?: { error: (msg: string) => void };
          };
          if ($toast) {
            $toast.error("Invalid authentication token. Please login.");
          }
        }

        // Continue to normal login flow (don't return, let code below handle it)
      }
    }

    console.log("[Auth Middleware] Auth initialized:", authStore.isInitialized);
    console.log("[Auth Middleware] Authenticated:", authStore.isAuthenticated);
    console.log("[Auth Middleware] Has tokens:", !!authStore.tokens?.accessToken);

    // Check if auth is still initializing - only on client side
    if (!authStore.isInitialized) {
      // For client-side navigation, wait for auth initialization
      // but immediately redirect if we know there's no token
      if (!authStore.tokens?.accessToken) {
        console.log("[Auth Middleware] No token and not initialized, redirecting to login");
        return navigateTo("/login");
      }
      console.log("[Auth Middleware] Auth not initialized yet but has token, waiting");
      return; // Let AuthProvider handle the loading state
    }

    // Check authentication status and user data presence
    const hasValidAuth = authStore.isAuthenticated && userStore.user?.id;

    if (!hasValidAuth) {
      // If authenticated but missing user data, clear auth state
      if (authStore.isAuthenticated && !userStore.user?.id) {
        console.log("[Auth Middleware] Authenticated but missing user data, logging out");
        authStore.logout();
        return;
      }

      return navigateTo("/login");
    }

    // Role-based route protection
    const currentOrganization = userStore.currentOrganization;
    const userRole = currentOrganization?.role;

    console.log("[Auth Middleware] User role:", userRole);
    console.log("[Auth Middleware] Has access:", hasRouteAccess(to.path, userRole));

    if (!hasRouteAccess(to.path, userRole)) {
      console.warn(`[Auth Middleware] Access denied to ${to.path} for role: ${userRole}`);

      // Prevent navigation to unauthorized page itself
      if (to.path === "/unauthorized") {
        return;
      }

      // Redirect to unauthorized page with the attempted path
      console.log("[Auth Middleware] Redirecting to unauthorized page");
      return navigateTo("/unauthorized?from=" + encodeURIComponent(to.path));
    }

    console.log("[Auth Middleware] Access granted");
  },
);
