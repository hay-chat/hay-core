<template>
  <div>
    <!-- Show loading state while initializing auth -->
    <div
      v-if="!authStore.isInitialized"
      class="flex items-center justify-center h-screen gap-2 flex-col"
    >
      <Loading />
    </div>

    <!-- Show content once auth is initialized -->
    <template v-else>
      <slot />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from "@/stores/auth";

const authStore = useAuthStore();
const route = useRoute();

// Initialize auth on mount if not already done
onMounted(async () => {
  // Define public paths that don't require authentication
  const publicPaths = new Set(["/login", "/signup", "/forgot-password"]);
  const isPublicPath = publicPaths.has(route.path);

  if (!authStore.isInitialized) {
    // Check if we have tokens before trying to initialize
    if (!authStore.tokens?.accessToken) {
      // No tokens, mark as initialized but not authenticated
      authStore.isInitialized = true;
      authStore.isAuthenticated = false;

      // Only redirect to login if we're not already on a public page
      if (!isPublicPath) {
        await navigateTo("/login");
      }
      return;
    }

    try {
      await authStore.initializeAuth();
    } catch (error) {
      console.error("[AuthProvider] Failed to initialize auth:", error);
      // Only logout and redirect if we're not on a public page
      if (!isPublicPath) {
        authStore.logout();
      } else {
        // Just mark as not authenticated but initialized
        authStore.isInitialized = true;
        authStore.isAuthenticated = false;
      }
    }
  }
});

// Cleanup on unmount
onUnmounted(() => {
  // No cleanup needed for now
});
</script>
