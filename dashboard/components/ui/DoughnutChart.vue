<template>
  <div class="chart-container">
    <Doughnut :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup lang="ts">
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import type { ChartOptions, ChartData } from "chart.js";
import { Doughnut } from "vue-chartjs";
import {
  getTooltipConfig,
  getLegendConfig,
  CHART_COLORS,
  getThemeColors,
} from "@/utils/chart-config";

ChartJS.register(ArcElement, Tooltip, Legend);

interface DoughnutDataItem {
  label: string;
  value: number;
  color?: string;
}

interface Props {
  data: DoughnutDataItem[];
  height?: number;
  showLegend?: boolean;
  theme?: keyof typeof CHART_COLORS;
  cutout?: string;
  colors?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  height: 300,
  showLegend: true,
  theme: "primary",
  cutout: "60%",
  colors: undefined,
});

const chartColors = computed(() => {
  if (props.colors && props.colors.length > 0) {
    return props.colors;
  }
  return getThemeColors(props.theme, props.data.length);
});

const chartData = computed<ChartData<"doughnut">>(() => ({
  labels: props.data.map((item) => item.label),
  datasets: [
    {
      data: props.data.map((item) => item.value),
      backgroundColor: props.data.map((item, index) => item.color || chartColors.value[index]),
      borderWidth: 0,
      hoverBorderWidth: 0,
      hoverOffset: 4,
    },
  ],
}));

const chartOptions = computed<ChartOptions<"doughnut">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  cutout: props.cutout,
  plugins: {
    legend: {
      ...getLegendConfig(props.showLegend),
      position: "bottom" as const,
    },
    tooltip: getTooltipConfig({ showPercentage: true }),
  },
}));
</script>

<style scoped>
.chart-container {
  position: relative;
  height: v-bind('props.height + "px"');
}
</style>
