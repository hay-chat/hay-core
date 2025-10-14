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
const refreshTimer = ref<number | null>(null);

// Initialize heartbeat for authenticated users
const { startHeartbeat, stopHeartbeat } = useHeartbeat();

const refresh = (e: Event) => {
  e.preventDefault();
  window.location.reload();
};

// Helper function to check if current route is public
const isPublicPath = computed(() => route.meta.public === true);

// Helper function to initialize auth
const initializeAuth = async () => {
  // Skip auth initialization entirely on public pages
  if (isPublicPath.value) {
    authStore.isInitialized = true;
    return;
  }

  if (!authStore.isInitialized) {
    // Check if we have tokens before trying to initialize
    if (!authStore.tokens?.accessToken) {
      // No tokens, mark as initialized but not authenticated
      authStore.isInitialized = true;
      authStore.isAuthenticated = false;

      // Only redirect to login if we're not already on a public page
      if (!isPublicPath.value) {
        await navigateTo("/login");
      }
      return;
    }

    try {
      await authStore.initializeAuth();

      // Start heartbeat after successful auth initialization
      if (authStore.isAuthenticated) {
        startHeartbeat();
      }
    } catch (error) {
      console.error("[AuthProvider] Failed to initialize auth:", error);

      // Only logout and redirect if we're not on a public page
      if (!isPublicPath.value) {
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
  }
};

// Initialize auth on mount
onMounted(async () => {
  await initializeAuth();
});

// Watch for auth state changes after mount
watch(
  () => authStore.isInitialized,
  async (newValue, oldValue) => {
    // If auth was just initialized (from false to true), start heartbeat if authenticated
    if (newValue && !oldValue && authStore.isAuthenticated) {
      startHeartbeat();
    }

    // If auth was just de-initialized (from true to false), stop heartbeat and handle redirect
    if (!newValue && oldValue) {
      stopHeartbeat();

      // If we're not on a public page, redirect to login
      if (!isPublicPath.value) {
        await navigateTo("/login");
      }
    }
  },
);

// Watch for authentication status changes
watch(
  () => authStore.isAuthenticated,
  (newValue, oldValue) => {
    // If user just logged out (from true to false), stop heartbeat
    if (!newValue && oldValue) {
      stopHeartbeat();
    }

    // If user just logged in (from false to true), start heartbeat
    if (newValue && !oldValue) {
      startHeartbeat();
    }
  },
);

// Cleanup on unmount
onUnmounted(() => {
  stopHeartbeat();
  if (refreshTimer.value) {
    clearTimeout(refreshTimer.value);
  }
});
</script>
