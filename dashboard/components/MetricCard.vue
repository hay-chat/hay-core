<template>
  <Card>
    <CardHeader class="flex !flex-row items-center justify-between gap-2 pb-2">
      <div class="flex items-center gap-2">
        <component :is="icon" class="h-4 w-4 text-neutral-muted" />
        <div class="text-sm font-medium !mt-0">
          {{ title }}
        </div>
      </div>
      <div v-if="showCacheIndicator && cacheAge" class="text-xs text-neutral-muted">
        <Clock class="h-3 w-3 inline mr-1" />
        {{ cacheAge }}
      </div>
    </CardHeader>
    <CardContent class="!pt-0">
      <div class="text-2xl font-bold">
        {{ formattedMetric }}
      </div>
      <p v-if="subtitle" class="text-xs text-neutral-muted flex gap-1">
        <span :class="subtitleClass">{{ subtitle }}</span>
        <span v-if="subtitleSuffix"> {{ subtitleSuffix }}</span>
      </p>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { computed, type Component } from "vue";
import { Clock } from "lucide-vue-next";

interface Props {
  title: string;
  icon: Component;
  metric: number | string;
  subtitle?: string;
  subtitleSuffix?: string;
  subtitleColor?: "green" | "red" | "default";
  formatMetric?: boolean;
  showCacheIndicator?: boolean;
  cacheAge?: string;
}

const props = withDefaults(defineProps<Props>(), {
  subtitleColor: "default",
  formatMetric: true,
  showCacheIndicator: false,
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
