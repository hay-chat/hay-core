<template>
  <span :key="changes" class="inline-block" :class="{ 'data-settle': changes > 0 }">
    <slot>{{ value }}</slot>
  </span>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{ value: string | number | null | undefined }>();

// Re-keyed on each change so the animation replays; never animates on first render.
const changes = ref(0);
watch(
  () => props.value,
  () => {
    changes.value++;
  },
);
</script>
