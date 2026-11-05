<template>
  <div
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="percent"
    :class="cn('relative h-4 w-full overflow-hidden rounded-full bg-neutral-200', $props.class)"
  >
    <div
      class="h-full w-full flex-1 bg-primary transition-all"
      :style="{ transform: `translateX(-${100 - percent}%)` }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/lib/utils";

export interface ProgressProps {
  value?: number;
  class?: string;
}

const props = withDefaults(defineProps<ProgressProps>(), {
  value: 0,
  class: "",
});

const percent = computed(() => Math.min(100, Math.max(0, props.value || 0)));
</script>
