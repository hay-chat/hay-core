<template>
  <div>
    <!-- Show loading state while initializing auth -->
    <div
      v-if="!authStore.isInitialized"
      class="flex items-center justify-center h-screen gap-2 flex-col"
    >
      <Loading />
      <div v-if="showRefreshMessage" class="text-sm text-gray-500">
        This is taking longer than expected.
        <a href="javascript:void(0)" class="text-blue-500 underline" @click="refresh"
          >Refresh the page</a
        >.
      </div>
    </div>

    <!-- Show content once auth is initialized -->
    <template v-else>
      <slot />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from "@/stores/auth";
import { useHeartbeat } from "@/composables/useHeartbeat";

const authStore = useAuthStore();
const route = useRoute();
const showRefreshMessage = ref(false);
let refreshTimer: any = null;

// Initialize heartbeat for authenticated users
const { startHeartbeat, stopHeartbeat } = useHeartbeat();

const refresh = (e: Event) => {
  e.preventDefault();
  window.location.reload();
};

// Initialize auth on mount if not already done
onMounted(async () => {
  // Check if the current route is marked as public
  const isPublicPath = route.meta.public === true;

  // Skip auth initialization entirely on public pages
  if (isPublicPath) {
    authStore.isInitialized = true;
    return;
  }

  if (!authStore.isInitialized) {
    // Start timer to show refresh message after 5 seconds
    refreshTimer = setTimeout(() => {
      showRefreshMessage.value = true;
      // Auto-refresh 3 seconds after showing the message (total 8 seconds)
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    }, 5000);

    // Check if we have tokens before trying to initialize
    if (!authStore.tokens?.accessToken) {
      // No tokens, mark as initialized but not authenticated
      authStore.isInitialized = true;
      authStore.isAuthenticated = false;

      // Clear the refresh timer since we handled this case
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }

      // Only redirect to login if we're not already on a public page
      if (!isPublicPath) {
        await navigateTo("/login");
      }
      return;
    }

    try {
      await authStore.initializeAuth();

      // Clear the refresh timer on successful initialization
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }

      // Start heartbeat after successful auth initialization
      if (authStore.isAuthenticated) {
        startHeartbeat();
      }
    } catch (error) {
      console.error("[AuthProvider] Failed to initialize auth:", error);

      // Clear the refresh timer before handling the error
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }

      // Only logout and redirect if we're not on a public page
      if (!isPublicPath) {
        authStore.logout();
      } else {
        // Just mark as not authenticated but initialized
        authStore.isInitialized = true;
        authStore.isAuthenticated = false;
      }
    }
  } else if (authStore.isAuthenticated) {
    // Auth already initialized and authenticated, start heartbeat
    startHeartbeat();

    // Clear the refresh timer since auth is already initialized
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }
});

// Cleanup on unmount
onUnmounted(() => {
  stopHeartbeat();
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
});
</script>
