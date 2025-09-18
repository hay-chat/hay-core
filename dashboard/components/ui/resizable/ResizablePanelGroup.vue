<template>
  <div
    v-bind="{ ...(id && { id }) }"
    :class="
      cn(
        'flex h-full w-full data-[panel-group-direction=horizontal]:flex-row data-[panel-group-direction=vertical]:flex-col',
        className,
      )
    "
    :data-panel-group-direction="direction"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/lib/utils";

interface ResizablePanelGroupProps {
  id?: string;
  direction?: "horizontal" | "vertical";
  class?: string | Record<string, boolean> | Array<string | Record<string, boolean>>;
}

const props = withDefaults(defineProps<ResizablePanelGroupProps>(), {
  direction: "horizontal",
});

const className = computed(() => props.class);
</script>
