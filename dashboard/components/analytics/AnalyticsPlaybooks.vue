<template>
  <AnalyticsState
    :loading="report.loading.value"
    :failed="report.failed.value"
    :empty="rows.length === 0"
    @retry="report.refresh()"
  >
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("analytics.playbooks.title") }}</CardTitle>
        <CardDescription>{{ $t("analytics.playbooks.description") }}</CardDescription>
      </CardHeader>
      <CardContent>
        <AnalyticsPerformanceTable :name-label="$t('analytics.playbooks.column')" :rows="rows" />
      </CardContent>
    </Card>
    <p class="mt-4 text-xs text-neutral-muted">{{ $t("analytics.playbooks.definition") }}</p>
  </AnalyticsState>
</template>

<script setup lang="ts">
import { HayApi } from "@/utils/api";
import { useAnalyticsReport } from "@/composables/useAnalyticsReport";
import type { ReportRange } from "@/utils/analytics";

const props = defineProps<{ range: ReportRange | null }>();
const { t } = useI18n();

const report = useAnalyticsReport(
  "playbooks",
  () => props.range,
  (range) => HayApi.analytics.playbooks.query(range),
);
defineExpose({ refresh: report.refresh, refreshing: report.refreshing });

const rows = computed(() =>
  (report.data.value?.playbooks ?? []).map((playbook) => {
    // No playbook handled the close, or the one that did was deleted since.
    if (!playbook.playbookId) {
      return { ...playbook, key: "none", name: t("analytics.playbooks.none"), muted: true };
    }
    if (playbook.title === null) {
      return {
        ...playbook,
        key: playbook.playbookId,
        name: t("analytics.playbooks.deleted"),
        muted: true,
      };
    }
    return {
      ...playbook,
      key: playbook.playbookId,
      name: playbook.title,
      to: `/playbooks/${playbook.playbookId}`,
    };
  }),
);
</script>
