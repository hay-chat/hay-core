<template>
  <PaginationLink
    :aria-label="ariaLabel"
    :size="size"
    :class="cn('gap-1 pr-2.5', props.class)"
    v-bind="$attrs"
  >
    <span>Next</span>
    <ChevronRightIcon class="h-4 w-4" />
  </PaginationLink>
</template>

<script setup lang="ts">
import { ChevronRightIcon } from "lucide-vue-next";
import { cn } from "@/lib/utils";
import PaginationLink from "./PaginationLink.vue";

export interface PaginationNextProps {
  ariaLabel?: string;
  size?: "default" | "sm" | "icon";
  class?: string;
}

const props = withDefaults(defineProps<PaginationNextProps>(), {
  ariaLabel: "Go to next page",
  size: "default",
});
</script>
