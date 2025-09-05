<template>
  <div>
    <!-- Show loading state while initializing auth -->
    <div v-if="!authStore.isInitialized" class="flex items-center justify-center h-screen">
      <div class="text-center">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p class="text-muted-foreground">Loading...</p>
      </div>
    </div>
    
    <!-- Show content once auth is initialized -->
    <template v-else>
      <slot />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();

// Initialize auth on mount if not already done
onMounted(async () => {
  if (!authStore.isInitialized) {
    try {
      await authStore.initializeAuth();
    } catch (error) {
      console.error('[AuthProvider] Failed to initialize auth:', error);
      // Auth store will handle logout if initialization fails
    }
  }
});

// Cleanup on unmount
onUnmounted(() => {
  // No cleanup needed for now
});
</script>
