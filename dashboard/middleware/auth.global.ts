import { logger } from "@/utils/logger";
import type { RouteLocationNormalized } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useUserStore, type User } from "@/stores/user";
import { redirectForSuspension, SUSPENDED_ROUTE } from "@/composables/useSuspension";
import { Hay } from "@/utils/api";
import { hasRouteAccess } from "@/utils/route-access";
import { clearRequestedOrganization, getRequestedOrganization } from "@/utils/org-history";
import { addOrgToLocation, NO_ACCESS_ROUTE, splitOrgFromLocation } from "@/utils/org-url";

const MFA_ENROLMENT_ROUTE = "/settings/profile";

/**
 * Open the page in the organization its URL named. The list is refreshed first:
 * the cached one can miss an organization the user just joined, or still hold
 * one they were removed from.
 */
async function enterRequestedOrganization(to: RouteLocationNormalized) {
  const organizationId = getRequestedOrganization();
  if (!organizationId || to.meta.public === true) return;

  const authStore = useAuthStore();
  const userStore = useUserStore();
  clearRequestedOrganization();
  const link = addOrgToLocation(to.fullPath, organizationId);

  if (!authStore.isAuthenticated || !userStore.user?.id) {
    return navigateTo({ path: "/login", query: { redirect: link } });
  }
  if (organizationId === userStore.activeOrganizationId) return;

  try {
    userStore.setUser((await Hay.auth.me.query()) as User);
  } catch (error) {
    console.warn("[Auth Middleware] Could not refresh organizations:", error);
  }

  if (await userStore.switchOrganization(organizationId)) return;
  return navigateTo({ path: NO_ACCESS_ROUTE, query: { redirect: link } }, { replace: true });
}

export default defineNuxtRouteMiddleware(
  async (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
    logger.debug("[Auth Middleware] Checking route:", to.path, "process.client:", process.client);

    if (process.client) {
      // A link to /<orgId>/... followed inside the app (after login, from an alert).
      const { organizationId, location } = splitOrgFromLocation(to.fullPath);
      if (organizationId) {
        if (organizationId === useUserStore().activeOrganizationId) {
          return navigateTo(location, { replace: true });
        }
        // Data for the current organization is already loaded: start clean.
        window.location.assign(addOrgToLocation(location, organizationId));
        return abortNavigation();
      }

      // Before the same-page check, which also matches the first load.
      const redirect = await enterRequestedOrganization(to);
      if (redirect) return redirect;
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
      if (!authStore.isAuthenticated) {
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

    if (to.path === NO_ACCESS_ROUTE) {
      return;
    }

    // Suspended organization: owners/admins may be sent to the operator's page,
    // everyone else is locked to /suspended until access is restored.
    let currentOrganization = userStore.currentOrganization;
    if (currentOrganization?.suspendedAt && to.path !== SUSPENDED_ROUTE) {
      // The store is persisted, so confirm with the server before locking anyone
      // out: a suspension lifted since the last visit must not bounce the user.
      try {
        const user = await Hay.auth.me.query();
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

    if (userStore.user?.mfaEnrolmentRequired && to.path !== MFA_ENROLMENT_ROUTE) {
      return navigateTo(MFA_ENROLMENT_ROUTE);
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
