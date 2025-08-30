<template>
  <nav
    role="navigation"
    aria-label="pagination"
    :class="cn('mx-auto flex w-full justify-center', props.class)"
    v-bind="$attrs"
  >
    <slot />
  </nav>
</template>

<script setup lang="ts">
import { cn } from "@/lib/utils";

export interface PaginationProps {
  class?: string;
}

const props = defineProps<PaginationProps>();
</script>