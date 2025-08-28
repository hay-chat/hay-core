import type { RouteLocationNormalized } from "vue-router";
import { useAuthStore } from "@/stores/auth";

export default defineNuxtRouteMiddleware(
  (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
    const authStore = useAuthStore();

    console.log("authStore", authStore);

    const publicPaths = new Set(["/login", "/signup", "/forgot-password"]);

    if (!authStore.isAuthenticated && !publicPaths.has(to.path)) {
      return navigateTo("/login");
    }
  }
);
