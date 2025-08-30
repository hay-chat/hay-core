<template>
  <span
    aria-hidden
    :class="cn('flex h-10 w-10 items-center justify-center', props.class)"
    v-bind="$attrs"
  >
    <MoreHorizontalIcon class="h-4 w-4" />
    <span class="sr-only">More pages</span>
  </span>
</template>

<script setup lang="ts">
import { MoreHorizontalIcon } from "lucide-vue-next";
import { cn } from "@/lib/utils";

export interface PaginationEllipsisProps {
  class?: string;
}

const props = defineProps<PaginationEllipsisProps>();
</script>