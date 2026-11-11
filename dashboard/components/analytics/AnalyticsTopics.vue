<template>
  <AnalyticsState
    :loading="report.loading.value"
    :failed="report.failed.value"
    :empty="rows.length === 0"
    :empty-title="$t('analytics.topics.emptyTitle')"
    :empty-description="$t('analytics.topics.emptyDescription')"
    @retry="report.refresh()"
  >
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("analytics.topics.title") }}</CardTitle>
        <CardDescription>
          {{
            $t("analytics.topics.coverage", {
              labelled: report.data.value?.labelled ?? 0,
              closes: report.data.value?.closes ?? 0,
            })
          }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AnalyticsPerformanceTable :name-label="$t('analytics.topics.column')" :rows="rows" />
      </CardContent>
    </Card>
    <p class="mt-4 text-xs text-neutral-muted">{{ $t("analytics.topics.definition") }}</p>
  </AnalyticsState>
</template>

<script setup lang="ts">
import { HayApi } from "@/utils/api";
import { useAnalyticsReport } from "@/composables/useAnalyticsReport";
import type { ReportRange } from "@/utils/analytics";

const props = defineProps<{ range: ReportRange | null }>();

const report = useAnalyticsReport(
  "topics",
  () => props.range,
  (range) => HayApi.analytics.topics.query(range),
);
defineExpose({ refresh: report.refresh, refreshing: report.refreshing });

const rows = computed(() =>
  (report.data.value?.topics ?? []).map((topic) => ({
    ...topic,
    key: topic.topic,
    name: topic.topic,
  })),
);
</script>
