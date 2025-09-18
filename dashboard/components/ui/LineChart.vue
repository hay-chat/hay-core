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

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

interface Props {
  data: Array<{ date?: string; chartIndex?: number; count: number; label?: string }>;
  height?: number;
  colors?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  height: 300,
  colors: () => ["#3B82F6"],
});

const chartData = computed<ChartData<"line">>(() => ({
  labels: props.data.map(
    (item, index) => item.date || item.label || `Day ${(item.chartIndex ?? index) + 1}`,
  ),
  datasets: [
    {
      label: "Conversations",
      data: props.data.map((item) => item.count),
      borderColor: props.colors[0],
      backgroundColor: props.colors[0] + "20",
      tension: 0.1,
    },
  ],
}));

const chartOptions = computed<ChartOptions<"line">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      mode: "index",
      intersect: false,
    },
  },
  scales: {
    x: {
      grid: {
        display: false,
      },
    },
    y: {
      beginAtZero: true,
      grid: {
        color: "#f3f4f6",
      },
    },
  },
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
