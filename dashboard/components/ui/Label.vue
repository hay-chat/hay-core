<template>
  <label
    :class="
      cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        $props.class,
      )
    "
    v-bind="$attrs"
  >
    <slot />
  </label>
</template>

<script setup lang="ts">
import { cn } from "@/lib/utils";

export interface LabelProps {
  class?: string;
}

const _props = withDefaults(defineProps<LabelProps>(), {
  class: "",
});
</script>
