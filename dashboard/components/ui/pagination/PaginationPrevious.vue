<template>
  <PaginationLink
    :aria-label="ariaLabel"
    :size="size"
    :class="cn('gap-1 pl-2.5', props.class)"
    v-bind="$attrs"
  >
    <ChevronLeftIcon class="h-4 w-4" />
    <span>Previous</span>
  </PaginationLink>
</template>

<script setup lang="ts">
import { ChevronLeftIcon } from "lucide-vue-next";
import { cn } from "@/lib/utils";
import PaginationLink from "./PaginationLink.vue";

export interface PaginationPreviousProps {
  ariaLabel?: string;
  size?: "default" | "sm" | "icon";
  class?: string;
}

const props = withDefaults(defineProps<PaginationPreviousProps>(), {
  ariaLabel: "Go to previous page",
  size: "default",
});
</script>