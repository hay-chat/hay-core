<template>
  <Card :class="cn('relative overflow-hidden', props.class)">
    <!-- Header with title and menu -->
    <CardHeader class="relative">
      <div class="flex items-center justify-between">
        <div>
          <CardTitle>{{ title }}</CardTitle>
          <CardDescription v-if="subtitle">{{ subtitle }}</CardDescription>
        </div>

        <!-- Menu dropdown -->
        <div v-if="showMenu" class="relative">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="sm" class="h-8 w-8 p-0">
                <MoreVertical class="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-48">
              <DropdownMenuItem @click="handleRefresh">
                <RefreshCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': isRefreshing }" />
                Refresh
              </DropdownMenuItem>
              <DropdownMenuSeparator v-if="additionalMenuItems && additionalMenuItems.length > 0" />
              <DropdownMenuItem
                v-for="item in additionalMenuItems"
                :key="item.label"
                @click="item.action"
              >
                <component v-if="item.icon" :is="item.icon" class="mr-2 h-4 w-4" />
                {{ item.label }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <!-- Loading indicator on header divider -->
      <div
        v-if="isLoading || isRefreshing"
        class="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden"
      >
        <div class="h-full w-full bg-primary/20">
          <div
            class="h-full bg-primary animate-indeterminate-progress"
            :class="{ 'opacity-60': isRefreshing && !isLoading }"
          />
        </div>
      </div>
    </CardHeader>

    <!-- Content area -->
    <CardContent>
      <!-- Error state -->
      <div v-if="error && !isLoading" class="py-8">
        <Error
          :message="errorMessage || 'Failed to load data'"
          :show-retry="true"
          @retry="handleRefresh"
        />
      </div>

      <!-- Loading state (initial load only) -->
      <div v-else-if="isLoading && !hasData" class="py-8">
        <Loading :label="loadingMessage" />
      </div>

      <!-- Empty state -->
      <div v-else-if="isEmpty && !isLoading" class="py-8 text-center">
        <component v-if="emptyStateIcon" :is="emptyStateIcon" class="mx-auto h-12 w-12 text-muted-foreground mb-3" />
        <p class="text-sm text-muted-foreground">{{ emptyStateMessage }}</p>
        <Button v-if="showRefreshOnEmpty" variant="outline" size="sm" class="mt-4" @click="handleRefresh">
          <RefreshCw class="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <!-- Chart content -->
      <div v-else-if="hasData" :class="{ 'opacity-50 pointer-events-none': isRefreshing }">
        <!-- Line Chart -->
        <LineChart
          v-if="chartType === 'line' && chartData"
          :data="chartData"
          v-bind="chartConfig"
        />

        <!-- Bar Chart -->
        <BarChart
          v-else-if="chartType === 'bar' && chartData"
          :data="chartData"
          v-bind="chartConfig"
        />

        <!-- Sentiment Gauge -->
        <SentimentGauge
          v-else-if="chartType === 'gauge' && chartData"
          v-bind="{ ...chartConfig, ...chartData }"
        />

        <!-- Custom content slot -->
        <slot v-else-if="chartType === 'custom'" name="content" :data="widgetData" />

        <!-- Default slot for any other content -->
        <slot v-else :data="widgetData" />
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type Component } from "vue";
import { MoreVertical, RefreshCw } from "lucide-vue-next";
import { useAnalyticsStore } from "@/stores/analytics";
import { cn } from "@/lib/utils";
import Card from "./Card.vue";
import CardHeader from "./CardHeader.vue";
import CardTitle from "./CardTitle.vue";
import CardDescription from "./CardDescription.vue";
import CardContent from "./CardContent.vue";
import Button from "./Button.vue";
import DropdownMenu from "./DropdownMenu.vue";
import DropdownMenuTrigger from "./DropdownMenuTrigger.vue";
import DropdownMenuContent from "./DropdownMenuContent.vue";
import DropdownMenuItem from "./DropdownMenuItem.vue";
import DropdownMenuSeparator from "./DropdownMenuSeparator.vue";
import LineChart from "./LineChart.vue";
import BarChart from "./BarChart.vue";
import SentimentGauge from "./SentimentGauge.vue";
import Loading from "./Loading.vue";
import Error from "./Error.vue";

export interface MenuItem {
  label: string;
  action: () => void;
  icon?: Component;
}

export interface WidgetProps {
  widgetId: string;
  title: string;
  subtitle?: string;
  chartType?: "line" | "bar" | "gauge" | "custom";
  chartConfig?: Record<string, any>;
  dataFetcher?: () => Promise<any>;
  refreshInterval?: number;
  ttl?: number;
  emptyStateMessage?: string;
  emptyStateIcon?: Component;
  errorMessage?: string;
  loadingMessage?: string;
  showMenu?: boolean;
  showRefreshOnEmpty?: boolean;
  additionalMenuItems?: MenuItem[];
  class?: string;
}

const props = withDefaults(defineProps<WidgetProps>(), {
  chartType: "custom",
  ttl: 5 * 60 * 1000, // 5 minutes default
  emptyStateMessage: "No data available",
  loadingMessage: "Loading...",
  showMenu: true,
  showRefreshOnEmpty: true,
});

const emit = defineEmits<{
  "data-fetched": [data: any];
  "error": [error: Error];
  "refresh": [];
}>();

const analyticsStore = useAnalyticsStore();
let refreshIntervalId: ReturnType<typeof setInterval> | null = null;

// Computed states
const widgetData = computed(() => analyticsStore.getWidgetData(props.widgetId));
const error = computed(() => analyticsStore.getWidgetError(props.widgetId));
const isLoading = computed(() => analyticsStore.isWidgetLoading(props.widgetId));
const isRefreshing = computed(() => analyticsStore.isWidgetRefreshing(props.widgetId));
const hasData = computed(() => widgetData.value !== undefined && widgetData.value !== null);

const isEmpty = computed(() => {
  if (!hasData.value) return true;
  if (Array.isArray(widgetData.value)) return widgetData.value.length === 0;
  if (typeof widgetData.value === "object") return Object.keys(widgetData.value).length === 0;
  return false;
});

// Transform data for charts
const chartData = computed(() => {
  if (!widgetData.value) return null;

  // If data is already in the correct format, return as is
  if (props.chartType === "gauge") {
    return widgetData.value;
  }

  // For line and bar charts, ensure data is an array
  if (Array.isArray(widgetData.value)) {
    return widgetData.value;
  }

  // If data has a specific structure, try to extract it
  if (widgetData.value.data && Array.isArray(widgetData.value.data)) {
    return widgetData.value.data;
  }

  // Return raw data and let the chart component handle it
  return widgetData.value;
});

// Methods
const fetchData = async (forceRefresh = false) => {
  if (!props.dataFetcher) return;

  try {
    const data = await analyticsStore.fetchData(
      props.widgetId,
      props.dataFetcher,
      { ttl: props.ttl, forceRefresh }
    );
    emit("data-fetched", data);
  } catch (err) {
    console.error(`Error fetching data for widget ${props.widgetId}:`, err);
    emit("error", err as Error);
  }
};

const handleRefresh = async () => {
  emit("refresh");
  await fetchData(true);
};

// Setup auto-refresh if interval is specified
const setupRefreshInterval = () => {
  if (!props.refreshInterval || props.refreshInterval <= 0) return;

  refreshIntervalId = setInterval(() => {
    fetchData(false);
  }, props.refreshInterval);
};

const clearRefreshInterval = () => {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
};

// Watch for changes in refresh interval
watch(() => props.refreshInterval, () => {
  clearRefreshInterval();
  setupRefreshInterval();
});

// Lifecycle hooks
onMounted(async () => {
  // Check if data needs to be fetched
  if (props.dataFetcher) {
    const isStale = analyticsStore.isDataStale(props.widgetId, props.ttl);
    if (isStale || !hasData.value) {
      await fetchData(false);
    }
  }

  // Setup auto-refresh if needed
  setupRefreshInterval();
});

onUnmounted(() => {
  clearRefreshInterval();
});
</script>

<style scoped>
@keyframes indeterminate-progress {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.animate-indeterminate-progress {
  animation: indeterminate-progress 1.5s linear infinite;
  width: 50%;
}
</style>