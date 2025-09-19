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

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface Props {
  data: Array<{ label: string; value: number; color?: string }>;
  height?: number;
  colors?: string[];
  title?: string;
  showLegend?: boolean;
  horizontal?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  height: 300,
  colors: () => ["#10B981", "#F59E0B", "#EF4444"], // Green, Yellow, Red for sentiment
  showLegend: false,
  horizontal: false,
});

const chartData = computed<ChartData<"bar">>(() => ({
  labels: props.data.map((item) => item.label),
  datasets: [
    {
      label: props.title || "Data",
      data: props.data.map((item) => item.value),
      backgroundColor: props.data.map((item, index) =>
        item.color || props.colors[index % props.colors.length]
      ),
      borderColor: props.data.map((item, index) =>
        item.color || props.colors[index % props.colors.length]
      ),
      borderWidth: 1,
    },
  ],
}));

const chartOptions = computed<ChartOptions<"bar">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: props.horizontal ? "y" : "x",
  plugins: {
    legend: {
      display: props.showLegend,
    },
    tooltip: {
      callbacks: {
        label: (context) => {
          const label = context.dataset.label || "";
          const value = context.parsed.y || context.parsed.x;
          // Check if we should show percentage
          const total = context.dataset.data.reduce((a, b) => (a as number) + (b as number), 0) as number;
          const percentage = ((value / total) * 100).toFixed(1);
          return `${label}: ${value} (${percentage}%)`;
        },
      },
    },
  },
  scales: {
    x: {
      grid: {
        display: false,
      },
      ticks: {
        color: "rgb(156, 163, 175)",
      },
    },
    y: {
      grid: {
        color: "rgba(156, 163, 175, 0.1)",
      },
      ticks: {
        color: "rgb(156, 163, 175)",
      },
      beginAtZero: true,
    },
  },
}));
</script>

<style scoped>
.chart-container {
  position: relative;
  height: v-bind(height + "px");
  width: 100%;
}
</style>