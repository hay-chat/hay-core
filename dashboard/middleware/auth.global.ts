import type { RouteLocationNormalized } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";

export default defineNuxtRouteMiddleware(
  (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
    // Skip auth check if staying on the same page (e.g., opening modals)
    if (to.path === from.path) {
      return;
    }
    
    const authStore = useAuthStore();
    const userStore = useUserStore();

    const publicPaths = new Set(["/login", "/signup", "/forgot-password"]);

    // Skip auth check for public paths
    if (publicPaths.has(to.path)) {
      return;
    }

    // Check if auth is still initializing
    if (!authStore.isInitialized) {
      return; // Let AuthProvider handle the loading state
    }

    // Check authentication status and user data presence
    const hasValidAuth = authStore.isAuthenticated && userStore.user?.id;

    if (!hasValidAuth) {
      // If authenticated but missing user data, clear auth state
      if (authStore.isAuthenticated && !userStore.user?.id) {
        console.log('[Auth Middleware] Authenticated but missing user data, logging out');
        authStore.logout();
        return;
      }
      
      return navigateTo("/login");
    }
  }
);
