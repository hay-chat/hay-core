<template>
  <div class="chart-container">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup lang="ts">
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import type { ChartOptions, ChartData } from "chart.js";
import { Line } from "vue-chartjs";
import {
  getChartColor,
  getTooltipConfig,
  getScaleConfig,
  getLegendConfig,
  CHART_COLORS,
} from "@/utils/chart-config";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

interface Props {
  data: Array<{ date?: string; chartIndex?: number; count: number; label?: string }>;
  height?: number;
  colors?: string[];
  showLegend?: boolean;
  theme?: keyof typeof CHART_COLORS;
  formatValue?: (value: number) => string;
}

const props = withDefaults(defineProps<Props>(), {
  height: 300,
  colors: undefined,
  showLegend: false,
  theme: "primary",
});

const chartColors = computed(() => {
  if (props.colors && props.colors.length > 0) {
    return props.colors;
  }
  return [getChartColor(0)];
});

const chartData = computed<ChartData<"line">>(() => ({
  labels: props.data.map(
    (item, index) => item.date || item.label || `Day ${(item.chartIndex ?? index) + 1}`,
  ),
  datasets: [
    {
      label: "Conversations",
      data: props.data.map((item) => item.count),
      borderColor: chartColors.value[0],
      backgroundColor: chartColors.value[0] + "20",
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: chartColors.value[0],
      pointBorderColor: "#ffffff",
      pointBorderWidth: 2,
      pointHoverBackgroundColor: chartColors.value[0],
      pointHoverBorderColor: "#ffffff",
      pointHoverBorderWidth: 2,
    },
  ],
}));

const chartOptions = computed<ChartOptions<"line">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: getLegendConfig(props.showLegend),
    tooltip: getTooltipConfig({
      formatValue: props.formatValue,
    }),
  },
  scales: getScaleConfig({
    hideXGrid: true,
    beginAtZero: true,
  }) as ChartOptions<"line">["scales"],
  interaction: {
    mode: "nearest",
    axis: "x",
    intersect: false,
  },
}));
</script>

<style scoped>
.chart-container {
  position: relative;
  height: v-bind('props.height + "px"');
}
</style>
