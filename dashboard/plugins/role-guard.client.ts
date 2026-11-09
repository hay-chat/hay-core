/**
 * Role-based route guard plugin
 * Checks user permissions after navigation and redirects if unauthorized
 */

import { useUserStore } from "@/stores/user";
import { useAuthStore } from "@/stores/auth";
import { hasRouteAccess } from "@/utils/route-access";

export default defineNuxtPlugin(() => {
  const router = useRouter();

  // Wait for stores to be ready before accessing them
  // This ensures persisted state is loaded
  let userStore: ReturnType<typeof useUserStore> | null = null;
  let authStore: ReturnType<typeof useAuthStore> | null = null;

  // Add router guard that runs after each navigation
  router.afterEach((to, from) => {
    // Lazily initialize stores on first use to ensure persistence has loaded
    if (!userStore || !authStore) {
      userStore = useUserStore();
      authStore = useAuthStore();
    }

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
