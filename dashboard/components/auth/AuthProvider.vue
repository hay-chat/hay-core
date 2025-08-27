<template>
  <div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { useGlobalAuth } from '~/composables/useGlobalAuth';

const { initialize, authStore, userStore } = useGlobalAuth();

// Provide auth store to child components
provide('auth', authStore);
provide('user', userStore);

// Initialize auth on mount if not already done
onMounted(async () => {
  await initialize();
});

// Cleanup on unmount
onUnmounted(() => {
  authStore.cancelTokenRefresh();
});
</script>
