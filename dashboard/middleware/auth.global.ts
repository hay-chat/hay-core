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
  (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
    // Skip auth check if staying on the same page (e.g., opening modals)
    if (to.path === from.path) {
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

    const authStore = useAuthStore();
    const userStore = useUserStore();

    // URL Token Auth for E2E Testing (Development Only)
    if (
      process.client &&
      to.query.auth_token &&
      process.env.NODE_ENV !== "production"
    ) {
      console.log(
        "[Auth Middleware] 🔐 URL token authentication detected (E2E testing mode)",
      );

      const token = to.query.auth_token as string;

      // Temporarily set token to validate
      authStore.tokens = {
        accessToken: token,
        refreshToken: "", // Not needed for validation
        expiresAt: Date.now() + 900000, // 15 minutes
      };

      try {
        // Validate by fetching user data
        const user = await Hay.auth.me.query();

        // Store valid auth state
        userStore.setUser(user as any);
        authStore.isAuthenticated = true;
        authStore.isInitialized = true;
        authStore.updateActivity();

        console.log("[Auth Middleware] ✅ URL token validated successfully");
        console.log(
          "[Auth Middleware] ⚠️  Warning: URL token auth is for development/testing only!",
        );

        // Remove token from URL for security
        const cleanPath = to.path;
        const cleanQuery = { ...to.query };
        delete cleanQuery.auth_token;

        return navigateTo(
          {
            path: cleanPath || "/",
            query: Object.keys(cleanQuery).length > 0 ? cleanQuery : undefined,
          },
          { replace: true },
        );
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

    // Check if auth is still initializing - only on client side
    if (process.client && !authStore.isInitialized) {
      // For client-side navigation, wait for auth initialization
      // but immediately redirect if we know there's no token
      if (!authStore.tokens?.accessToken) {
        return navigateTo("/login");
      }
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

    if (!hasRouteAccess(to.path, userRole)) {
      console.warn(
        `[Auth Middleware] Access denied to ${to.path} for role: ${userRole}`,
      );
      // Redirect to home page with error message
      return navigateTo({
        path: "/",
        query: { error: "unauthorized" },
      });
    }
  },
);
