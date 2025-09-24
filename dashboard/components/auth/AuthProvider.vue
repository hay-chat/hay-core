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

// Initialize auth on mount if not already done
onMounted(async () => {
  if (!authStore.isInitialized) {
    try {
      await authStore.initializeAuth();
    } catch (error) {
      console.error("[AuthProvider] Failed to initialize auth:", error);
      authStore.logout();
    }
  }
});

// Cleanup on unmount
onUnmounted(() => {
  // No cleanup needed for now
});
</script>
