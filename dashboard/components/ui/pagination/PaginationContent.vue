<template>
  <ul
    :class="cn('flex flex-row items-center gap-1', props.class)"
    v-bind="$attrs"
  >
    <slot />
  </ul>
</template>

<script setup lang="ts">
import { cn } from "@/lib/utils";

export interface PaginationContentProps {
  class?: string;
}

const props = defineProps<PaginationContentProps>();
</script>