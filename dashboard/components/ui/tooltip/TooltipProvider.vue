<template>
  <div>
    <slot />
  </div>
</template>

<script setup lang="ts">
interface TooltipProviderProps {
  delayDuration?: number;
}

const _props = withDefaults(defineProps<TooltipProviderProps>(), {
  delayDuration: 700,
});
</script>
