<template>
  <!-- One segment per colour, as wide as its share of the list. Each names itself on hover/focus. -->
  <TooltipProvider :delay-duration="100">
    <ul class="flex h-2 gap-[3px]" :aria-label="$t('setup.board.progressLabel')">
      <TooltipRoot v-for="segment in segments" :key="segment.key">
        <TooltipTrigger as-child>
          <li
            tabindex="0"
            :class="[
              'h-full transition-[flex-grow,opacity] duration-300 first:rounded-l last:rounded-r focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none',
              segment.classes,
            ]"
            :style="{ flexGrow: segment.count, flexBasis: 0 }"
            :aria-label="segment.label"
            :data-status="segment.key"
          />
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent
            :side-offset="6"
            class="z-50 rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium tabular-nums text-white shadow-md"
          >
            {{ segment.label }}
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    </ul>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "reka-ui";
import type { SetupRowStatus } from "@/stores/setup";
import { STATUS_BAR_CLASSES, STATUS_ORDER } from "./status";

const props = defineProps<{ statuses: SetupRowStatus[] }>();

const { t } = useI18n();

// Statuses that share a colour share a segment, so the bar shows one block per colour.
const segments = computed(() => {
  const merged: Array<{ key: string; classes: string; count: number; label: string }> = [];
  for (const status of STATUS_ORDER) {
    const count = props.statuses.filter((s) => s === status).length;
    if (!count) continue;
    const label = `${t(`setup.status.${status}`)} · ${count}`;
    const last = merged[merged.length - 1];
    if (last?.classes === STATUS_BAR_CLASSES[status]) {
      last.count += count;
      last.label += `, ${label}`;
    } else {
      merged.push({ key: status, classes: STATUS_BAR_CLASSES[status], count, label });
    }
  }
  return merged;
});
</script>
