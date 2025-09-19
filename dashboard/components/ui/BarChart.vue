<template>
  <div class="chart-container">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup lang="ts">
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import type { ChartOptions, ChartData } from "chart.js";
import { Bar } from "vue-chartjs";
import {
  getChartColor,
  getTooltipConfig,
  getScaleConfig,
  getLegendConfig,
  SENTIMENT_COLORS,
  CHART_COLORS,
  getThemeColors,
} from "@/utils/chart-config";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface Props {
  data: Array<{ label: string; value: number; color?: string }>;
  height?: number;
  colors?: string[];
  title?: string;
  showLegend?: boolean;
  horizontal?: boolean;
  showPercentage?: boolean;
  theme?: keyof typeof CHART_COLORS;
  useSentimentColors?: boolean;
  formatValue?: (value: number) => string;
}

const props = withDefaults(defineProps<Props>(), {
  height: 300,
  colors: undefined,
  showLegend: false,
  horizontal: false,
  showPercentage: true,
  theme: "primary",
  useSentimentColors: false,
});

const chartColors = computed(() => {
  if (props.colors && props.colors.length > 0) {
    return props.colors;
  }
  if (props.useSentimentColors) {
    return [SENTIMENT_COLORS.positive, SENTIMENT_COLORS.neutral, SENTIMENT_COLORS.negative];
  }
  return getThemeColors(props.theme, props.data.length);
});

const chartData = computed<ChartData<"bar">>(() => ({
  labels: props.data.map((item) => item.label),
  datasets: [
    {
      label: props.title || "Data",
      data: props.data.map((item) => item.value),
      backgroundColor: props.data.map((item, index) =>
        item.color || chartColors.value[index % chartColors.value.length]
      ),
      borderColor: props.data.map((item, index) =>
        item.color || chartColors.value[index % chartColors.value.length]
      ),
      borderWidth: 0,
      borderRadius: 4,
      barThickness: undefined,
      maxBarThickness: 60,
    },
  ],
}));

const chartOptions = computed<ChartOptions<"bar">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: props.horizontal ? "y" : "x",
  plugins: {
    legend: getLegendConfig(props.showLegend),
    tooltip: getTooltipConfig({
      showPercentage: props.showPercentage,
      formatValue: props.formatValue,
    }),
  },
  scales: getScaleConfig({
    hideXGrid: true,
    hideYGrid: false,
    beginAtZero: true,
  }) as ChartOptions<"bar">["scales"],
}));
</script>

<style scoped>
.chart-container {
  position: relative;
  height: v-bind(height + "px");
  width: 100%;
}
</style>