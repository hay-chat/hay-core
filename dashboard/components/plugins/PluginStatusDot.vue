<template>
  <!-- Colour alone never carries the status: the dot is named for screen readers and on hover. -->
  <TooltipProvider :delay-duration="150">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <span
          role="img"
          :aria-label="label"
          class="inline-flex h-5 w-5 shrink-0 items-center justify-center"
          data-testid="plugin-status-dot"
          :data-status="status"
        >
          <span
            aria-hidden="true"
            :class="[
              'h-2 w-2 rounded-full',
              status === 'connected' ? 'bg-green-600' : 'bg-amber-600',
            ]"
          ></span>
        </span>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="side"
          :side-offset="4"
          class="z-50 rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white shadow-md"
        >
          {{ label }}
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
import type { PluginStatus } from "@/stores/app";

const props = withDefaults(
  defineProps<{
    status: PluginStatus;
    side?: "top" | "right" | "bottom" | "left";
  }>(),
  { side: "top" },
);

const { t } = useI18n();
const label = computed(() =>
  props.status === "connected"
    ? t("marketplace.status.connected")
    : t("marketplace.status.needsSetup"),
);
</script>
