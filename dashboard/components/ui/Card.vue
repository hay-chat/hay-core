<template>
  <div
    :class="
      cn(
        'rounded-lg border bg-background text-neutral shadow-sm flex flex-col -gap-4',
        $props.class,
      )
    "
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { cn } from "@/lib/utils";

export interface CardProps {
  class?: string | string[] | Record<string, boolean>;
}

const _props = withDefaults(defineProps<CardProps>(), {
  class: "",
});
</script>
