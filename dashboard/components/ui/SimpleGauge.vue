<template>
  <div class="flex flex-col items-center m-auto">
    <!-- CSS-only gauge -->
    <div
      class="gauge"
      :style="`width: ${size}px; --rotation: ${rotation}deg; --color: ${gaugeColor}; --background: ${backgroundColor};`"
    >
      <div class="percentage"></div>
      <div class="mask"></div>
      <span class="value text-3xl font-bold">{{ displayValue }}</span>
      <span class="label text-sm text-muted-foreground">{{ displayLabel }}</span>
    </div>

    <!-- Sentiment breakdown if provided -->
    <div v-if="showBreakdown && counts" class="mt-6 grid grid-cols-3 gap-4 text-center w-full">
      <div>
        <div class="text-2xl text-green-600">{{ counts.pos }}</div>
        <div class="text-xs text-muted-foreground">Positive</div>
      </div>
      <div>
        <div class="text-2xl text-gray-500">{{ counts.neu }}</div>
        <div class="text-xs text-muted-foreground">Neutral</div>
      </div>
      <div>
        <div class="text-2xl text-red-600">{{ counts.neg }}</div>
        <div class="text-xs text-muted-foreground">Negative</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

interface SentimentCounts {
  pos: number;
  neu: number;
  neg: number;
}

interface SentimentOptions {
  wN?: number;
  lambda?: number;
  alpha?: {
    pos?: number;
    neu?: number;
    neg?: number;
  };
}

export interface SimpleGaugeProps {
  title?: string;
  subtitle?: string;
  counts?: SentimentCounts;
  value?: number;
  maxValue?: number;
  displayFormat?: "percentage" | "value" | "currency";
  currencySymbol?: string;
  showBreakdown?: boolean;
  showViewReport?: boolean;
  size?: number;
  sentimentOptions?: SentimentOptions;
  class?: string;
}

const props = withDefaults(defineProps<SimpleGaugeProps>(), {
  title: "Sentiment Score",
  subtitle: "",
  displayFormat: "percentage",
  currencySymbol: "$",
  showBreakdown: false,
  showViewReport: false,
  size: 240,
});

const emit = defineEmits<{
  "view-report": [];
}>();

function sentimentScore(counts: SentimentCounts, opts: SentimentOptions = {}): number {
  const { wN = 0.6, lambda = 1.2, alpha = { pos: 0, neu: 0, neg: 0 } } = opts;

  const pos = Math.max(0, Number(counts.pos) || 0) + (Number(alpha.pos) || 0);
  const neu = Math.max(0, Number(counts.neu) || 0) + (Number(alpha.neu) || 0);
  const neg = Math.max(0, Number(counts.neg) || 0) + (Number(alpha.neg) || 0);
  const total = pos + neu + neg;

  if (total === 0) return 50;

  const A = (pos * 1 + neu * wN - neg * lambda) / total;
  const score = ((A + lambda) / (1 + lambda)) * 100;
  return Math.max(0, Math.min(100, score));
}

const calculatedScore = computed(() => {
  if (props.counts) {
    return sentimentScore(props.counts, props.sentimentOptions);
  }
  if (props.value !== undefined && props.maxValue !== undefined) {
    return (props.value / props.maxValue) * 100;
  }
  return 50;
});

// Convert percentage (0-100) to rotation degrees (0-180)
const rotation = computed(() => {
  return (calculatedScore.value / 100) * 180;
});

const gaugeColor = computed(() => {
  const score = calculatedScore.value;
  if (score < 40) return "#ef4444"; // red
  if (score < 60) return "#f59e0b"; // amber
  if (score < 80) return "#22c55e"; // green
  return "#10b981"; // emerald
});

const backgroundColor = computed(() => "#e5e7eb");

const displayValue = computed(() => {
  if (props.displayFormat === "percentage") {
    return `${Math.round(calculatedScore.value)}%`;
  } else if (props.displayFormat === "currency" && props.value !== undefined) {
    return `${props.currencySymbol}${props.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else if (props.value !== undefined) {
    return props.value.toLocaleString();
  }
  return `${Math.round(calculatedScore.value)}%`;
});

const displayLabel = computed(() => {
  if (props.displayFormat === "currency" && props.maxValue !== undefined) {
    return `of ${props.currencySymbol}${props.maxValue.toLocaleString()}`;
  } else if (props.displayFormat === "value" && props.maxValue !== undefined) {
    return `of ${props.maxValue.toLocaleString()}`;
  } else if (props.counts) {
    const score = calculatedScore.value;
    if (score >= 80) return "Excellent";
    if (score >= 60) return "Good";
    if (score >= 40) return "Fair";
    return "Needs Improvement";
  }
  return "";
});
</script>

<style scoped>
.gauge {
  position: relative;
  border-radius: 50%/100% 100% 0 0;
  background-color: var(--color, #10b981);
  overflow: hidden;
  margin: 0 auto;
}

.gauge:before {
  content: "";
  display: block;
  padding-top: 50%; /* ratio of 2:1*/
}

.gauge .mask {
  position: absolute;
  left: 15%;
  right: 15%;
  bottom: 0;
  top: 30%;
  background-color: #fff;
  border-radius: 50%/100% 100% 0 0;
  z-index: 2;
}

.gauge .percentage {
  position: absolute;
  top: -1px;
  left: -1px;
  bottom: 0;
  right: -1px;
  background-color: var(--background, #e5e7eb);
  transform: rotate(var(--rotation));
  transform-origin: bottom center;
  transition: transform 600ms ease-in-out;
  z-index: 1;
}

.gauge .value {
  position: absolute;
  bottom: 15%;
  left: 0;
  width: 100%;
  text-align: center;
  z-index: 3;
}

.gauge .label {
  position: absolute;
  bottom: 5%;
  left: 0;
  width: 100%;
  text-align: center;
  z-index: 3;
}
</style>
