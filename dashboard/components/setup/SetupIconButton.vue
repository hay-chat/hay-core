<template>
  <!-- An icon-only button always names its action: as its accessible name and in a tooltip. -->
  <TooltipProvider :delay-duration="300">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <button
          type="button"
          :aria-label="label"
          class="grid h-11 w-11 shrink-0 place-items-center rounded-md text-neutral-muted hover:bg-accent hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:w-8"
          v-bind="$attrs"
        >
          <slot />
        </button>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="side"
          :side-offset="4"
          class="z-50 rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white shadow-md"
        >
          {{ tooltip ?? label }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>

<script setup lang="ts">
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "reka-ui";

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    /** What the button does, read by screen readers. */
    label: string;
    /** A shorter text for the tooltip, when the label names the item too. Defaults to `label`. */
    tooltip?: string;
    side?: "top" | "right" | "bottom" | "left";
  }>(),
  { tooltip: undefined, side: "top" },
);
</script>
