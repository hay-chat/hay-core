<template>
  <div>
    <slot />
  </div>
</template>

<script setup lang="ts">
// Initialize auth on mount if not already done
onMounted(async () => {
  // await initialize();
});

// Cleanup on unmount
onUnmounted(() => {
  // authStore.cancelTokenRefresh();
});
</script>
