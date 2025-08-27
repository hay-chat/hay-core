<template>
  <div
    :class="
      cn(
        'relative h-4 w-full overflow-hidden rounded-full bg-secondary',
        $props.class
      )
    "
  >
    <div
      class="h-full w-full flex-1 bg-primary transition-all"
      :style="{ transform: `translateX(-${100 - (value || 0)}%)` }"
    />
  </div>
</template>

<script setup lang="ts">
import { cn } from "@/lib/utils";

export interface ProgressProps {
  value?: number;
  class?: string;
}

const _props = withDefaults(defineProps<ProgressProps>(), {
  value: 0,
  class: "",
});
</script>
