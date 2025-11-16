<template>
  <div
    :class="
      cn(
        'px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-neutral-muted',
        $props.class,
      )
    "
  >
    <slot /> {{ label }}
  </div>
</template>

<script setup lang="ts">
import { cn } from "@/lib/utils";

export interface DropdownMenuLabelProps {
  label: string;
  class?: string;
}

const _props = withDefaults(defineProps<DropdownMenuLabelProps>(), {
  label: "",
  class: "",
});
</script>
