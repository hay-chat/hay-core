import type { RouteLocationNormalized } from "vue-router";
import { useAuthStore } from "@/stores/auth";

export default defineNuxtRouteMiddleware(
  (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
    // Skip auth check if staying on the same page (e.g., opening modals)
    if (to.path === from.path) {
      return;
    }
    
    const authStore = useAuthStore();

    const publicPaths = new Set(["/login", "/signup", "/forgot-password"]);

    if (!authStore.isAuthenticated && !publicPaths.has(to.path)) {
      return navigateTo("/login");
    }
  }
);
