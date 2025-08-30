<template>
  <li :class="cn('', props.class)" v-bind="$attrs">
    <slot />
  </li>
</template>

<script setup lang="ts">
import { cn } from "@/lib/utils";

export interface PaginationItemProps {
  class?: string;
}

const props = defineProps<PaginationItemProps>();
</script>