<template>
  <Card>
    <CardHeader class="flex !flex-row items-center justify-between gap-2 pb-2">
      <div class="flex items-center gap-2">
        <component :is="icon" class="h-4 w-4 text-neutral-muted" />
        <div class="text-sm font-medium !mt-0">
          {{ title }}
        </div>
      </div>
    </CardHeader>
    <CardContent class="!pt-0">
      <!-- Sized to the value, so the card keeps its height when data arrives. -->
      <div
        v-if="loading"
        class="my-1 h-6 w-20 animate-pulse rounded bg-background-tertiary motion-reduce:animate-none"
        data-testid="metric-skeleton"
      />
      <div v-else class="text-2xl font-bold">
        <SettleValue :value="formattedMetric" />
      </div>
      <div
        v-if="loading"
        class="mt-1 h-3 w-24 animate-pulse rounded bg-background-tertiary motion-reduce:animate-none"
      />
      <p v-else-if="subtitle" class="text-xs text-neutral-muted flex gap-1">
        <span :class="subtitleClass">{{ subtitle }}</span>
        <span v-if="subtitleSuffix"> {{ subtitleSuffix }}</span>
      </p>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { computed, type Component } from "vue";

interface Props {
  title: string;
  icon: Component;
  metric: number | string;
  subtitle?: string;
  subtitleSuffix?: string;
  subtitleColor?: "green" | "red" | "default";
  formatMetric?: boolean;
  /** No value yet: show a placeholder rather than a misleading zero. */
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  subtitleColor: "default",
  formatMetric: true,
});

const formattedMetric = computed(() => {
  if (typeof props.metric === "number" && props.formatMetric) {
    return props.metric.toLocaleString();
  }
  return props.metric;
});

const subtitleClass = computed(() => {
  switch (props.subtitleColor) {
    case "green":
      return "text-green-600";
    case "red":
      return "text-red-600";
    default:
      return "";
  }
});
</script>
