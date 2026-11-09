<template>
  <Card>
    <CardHeader>
      <div class="flex items-center justify-between">
        <div>
          <CardTitle>Knowledge Base</CardTitle>
          <CardDescription>Documents by status</CardDescription>
        </div>
        <div class="flex items-center gap-1">
          <RefreshIndicator :active="query.refreshing.value" />
          <Button variant="ghost" size="sm" @click="goToDocuments">
            View All
            <ChevronRight class="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </CardHeader>
    <CardContent>
      <!-- Loading State -->
      <div v-if="isLoading" class="h-[300px] flex items-center justify-center">
        <Loading />
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="text-center py-8 text-neutral-muted">
        <AlertCircle class="h-12 w-12 mx-auto mb-2 opacity-50 text-red-400" />
        <p>Failed to load document stats</p>
        <Button variant="outline" size="sm" class="mt-4" @click="retry"> Retry </Button>
      </div>

      <!-- Empty State -->
      <div v-else-if="totalDocuments === 0" class="text-center py-8 text-neutral-muted">
        <FileText class="h-12 w-12 mx-auto mb-2 opacity-50" />
        <p>No documents yet</p>
        <Button variant="outline" size="sm" class="mt-4" @click="goToDocuments">
          Add Documents
        </Button>
      </div>

      <!-- Chart -->
      <template v-else>
        <div class="text-center mb-4">
          <span class="text-3xl font-bold text-foreground">
            <SettleValue :value="totalDocuments" />
          </span>
          <span class="text-sm text-neutral-muted ml-1">total documents</span>
        </div>
        <DoughnutChart :data="chartData" :height="250" :colors="statusColors" :show-legend="true" />
      </template>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { FileText, ChevronRight, AlertCircle } from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { CHART_COLORS } from "@/utils/chart-config";

const router = useRouter();
const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  published: { label: "Published", color: CHART_COLORS.success[1] },
  draft: { label: "Draft", color: CHART_COLORS.warning[1] },
  under_review: { label: "Under Review", color: CHART_COLORS.primary[2] },
  processing: { label: "Processing", color: CHART_COLORS.action[1] },
  archived: { label: "Archived", color: CHART_COLORS.neutral[3] },
  error: { label: "Error", color: CHART_COLORS.danger[1] },
};

interface StatusCount {
  status: string;
  count: number;
}

const query = useCachedQuery(
  () => ["analytics", "documentStatusCounts"] as const,
  () => HayApi.analytics.documentStatusCounts.query(),
);

const documentStats = computed(() => (query.data.value?.data ?? []) as StatusCount[]);
const error = computed(() => !!query.error.value && query.data.value === undefined);
const isLoading = query.loading;

const totalDocuments = computed(() =>
  documentStats.value.reduce((sum, item) => sum + item.count, 0),
);

// Filter out statuses with 0 count for cleaner chart display
const activeStats = computed(() => documentStats.value.filter((item) => item.count > 0));

const chartData = computed(() =>
  activeStats.value.map((item) => ({
    label: STATUS_CONFIG[item.status]?.label || item.status,
    value: item.count,
  })),
);

const statusColors = computed(() =>
  activeStats.value.map((item) => STATUS_CONFIG[item.status]?.color || CHART_COLORS.neutral[3]),
);

const retry = () => void query.refresh();

const goToDocuments = () => {
  router.push("/documents");
};

defineExpose({ refresh: () => void query.refresh() });
</script>
