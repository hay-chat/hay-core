<template>
  <Card>
    <CardHeader class="flex !flex-row items-center gap-2 pb-2">
      <component :is="icon" class="h-4 w-4 text-muted-foreground" />
      <div class="text-sm font-medium !mt-0">{{ title }}</div>
    </CardHeader>
    <CardContent class="!pt-0">
      <div class="text-2xl font-bold">
        {{ formattedMetric }}
      </div>
      <p v-if="subtitle" class="text-xs text-muted-foreground">
        <span :class="subtitleClass">{{ subtitle }}</span>
        <span v-if="subtitleSuffix"> {{ subtitleSuffix }}</span>
      </p>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Card from "@/components/ui/Card.vue";
import CardContent from "@/components/ui/CardContent.vue";
import CardHeader from "@/components/ui/CardHeader.vue";

interface Props {
  title: string;
  icon: any;
  metric: number | string;
  subtitle?: string;
  subtitleSuffix?: string;
  subtitleColor?: "green" | "red" | "default";
  formatMetric?: boolean;
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
