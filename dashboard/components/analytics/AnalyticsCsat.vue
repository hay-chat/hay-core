<template>
  <AnalyticsState
    :loading="report.loading.value"
    :failed="report.failed.value"
    :empty="current.rated === 0"
    :empty-title="$t('analytics.csat.emptyTitle')"
    :empty-description="$t('analytics.csat.emptyDescription', { count: current.surveyed })"
    @retry="report.refresh()"
  >
    <div class="grid gap-4 mb-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        :title="$t('analytics.csat.average')"
        :icon="Star"
        :metric="formatScore(current.average)"
        :format-metric="false"
        v-bind="delta(current.average, previous.average, 'score')"
      />
      <MetricCard
        :title="$t('analytics.csat.responseRate')"
        :icon="MessageSquare"
        :metric="formatRate(current.responseRate)"
        :format-metric="false"
        v-bind="delta(current.responseRate, previous.responseRate, 'points')"
      />
      <MetricCard
        :title="$t('analytics.csat.aiAverage')"
        :icon="Sparkles"
        :metric="formatScore(current.ai.average)"
        :format-metric="false"
        :subtitle="$t('analytics.csat.ratings', { count: current.ai.rated })"
      />
      <MetricCard
        :title="$t('analytics.csat.humanAverage')"
        :icon="UserRound"
        :metric="formatScore(current.human.average)"
        :format-metric="false"
        :subtitle="$t('analytics.csat.ratings', { count: current.human.rated })"
      />
    </div>

    <div class="grid gap-4 mb-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("analytics.csat.trendTitle") }}</CardTitle>
          <CardDescription>{{ $t("analytics.csat.trendDescription") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <LineChart
            :data="trend"
            :height="260"
            :label="$t('analytics.csat.average')"
            :format-value="(value: number) => value.toFixed(2)"
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("analytics.csat.distributionTitle") }}</CardTitle>
          <CardDescription>
            {{ $t("analytics.csat.ratings", { count: current.rated }) }}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BarChart :data="distribution" :height="260" :show-percentage="false" />
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>{{ $t("analytics.csat.lowScoresTitle") }}</CardTitle>
        <CardDescription>{{ $t("analytics.csat.lowScoresDescription") }}</CardDescription>
      </CardHeader>
      <CardContent>
        <p v-if="lowScores.length === 0" class="py-8 text-center text-sm text-neutral-muted">
          {{ $t("analytics.csat.noLowScores") }}
        </p>
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead>{{ $t("analytics.csat.columns.conversation") }}</TableHead>
              <TableHead class="!text-right">{{ $t("analytics.csat.columns.rating") }}</TableHead>
              <TableHead>{{ $t("analytics.csat.columns.handledBy") }}</TableHead>
              <TableHead>{{ $t("analytics.csat.columns.ratedAt") }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in lowScores" :key="row.conversationId">
              <TableCell>
                <NuxtLink
                  :to="`/conversations/${row.conversationId}`"
                  class="font-medium text-primary hover:underline"
                >
                  {{ row.title || $t("analytics.csat.untitled") }}
                </NuxtLink>
              </TableCell>
              <TableCell class="text-right tabular-nums">{{ row.rating }} / 5</TableCell>
              <TableCell>
                {{ row.handedOff ? $t("analytics.csat.human") : $t("analytics.csat.ai") }}
              </TableCell>
              <TableCell class="text-neutral-muted">{{ formatShortDate(row.ratedAt) }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <p class="mt-4 text-xs text-neutral-muted">{{ $t("analytics.csat.definition") }}</p>
  </AnalyticsState>
</template>

<script setup lang="ts">
import { MessageSquare, Sparkles, Star, UserRound } from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { useAnalyticsReport } from "@/composables/useAnalyticsReport";
import { useDelta } from "@/composables/useDelta";
import { formatRate, formatScore, type ReportRange } from "@/utils/analytics";
import { formatShortDate } from "@/utils/date";
import type { RouterOutputs } from "@/types/trpc";

type Summary = RouterOutputs["analytics"]["csat"]["current"];

const props = defineProps<{ range: ReportRange | null }>();

const report = useAnalyticsReport(
  "csat",
  () => props.range,
  (range) => HayApi.analytics.csat.query(range),
);
defineExpose({ refresh: report.refresh, refreshing: report.refreshing });

const delta = useDelta();

const NO_GROUP = { surveyed: 0, rated: 0, average: null };
const EMPTY: Summary = {
  ...NO_GROUP,
  responseRate: null,
  ai: NO_GROUP,
  human: NO_GROUP,
  distribution: [0, 0, 0, 0, 0],
};
const current = computed(() => report.data.value?.current ?? EMPTY);
const previous = computed(() => report.data.value?.previous ?? EMPTY);
const lowScores = computed(() => report.data.value?.lowScores ?? []);

const trend = computed(() =>
  (report.data.value?.trend ?? []).map((day) => ({ date: day.date, count: day.average })),
);
const distribution = computed(() =>
  current.value.distribution.map((count, index) => ({ label: `${index + 1} ★`, value: count })),
);
</script>
