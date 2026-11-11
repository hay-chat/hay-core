<template>
  <AnalyticsState
    :loading="report.loading.value"
    :failed="report.failed.value"
    :empty="current.closes === 0"
    @retry="report.refresh()"
  >
    <div class="grid gap-4 mb-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        :title="$t('analytics.overview.aiResolutionRate')"
        :icon="Sparkles"
        :metric="formatRate(current.aiResolutionRate)"
        :format-metric="false"
        v-bind="delta(current.aiResolutionRate, previous.aiResolutionRate, 'points')"
      />
      <MetricCard
        :title="$t('analytics.overview.aiResolved')"
        :icon="CheckCircle"
        :metric="current.aiResolved"
        v-bind="delta(current.aiResolved, previous.aiResolved, 'percent')"
      />
      <MetricCard
        :title="$t('analytics.overview.closes')"
        :icon="MessageSquare"
        :metric="current.closes"
        v-bind="delta(current.closes, previous.closes, 'percent')"
      />
      <MetricCard
        :title="$t('analytics.overview.handoffRate')"
        :icon="UserRound"
        :metric="formatRate(current.handoffRate)"
        :format-metric="false"
        v-bind="delta(current.handoffRate, previous.handoffRate, 'points', false)"
      />
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("analytics.overview.trendTitle") }}</CardTitle>
          <CardDescription>{{ $t("analytics.overview.trendDescription") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <LineChart
            :data="rateTrend"
            :height="280"
            :label="$t('analytics.overview.aiResolutionRate')"
            :format-value="(value: number) => formatRate(value)"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{{ $t("analytics.overview.outcomesTitle") }}</CardTitle>
          <CardDescription>{{ $t("analytics.overview.outcomesDescription") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul class="space-y-4">
            <li v-for="outcome in outcomes" :key="outcome.key">
              <div class="flex items-baseline justify-between gap-4 text-sm">
                <span class="font-medium text-foreground">
                  {{ $t(`analytics.outcomes.${outcome.key}.label`) }}
                </span>
                <span class="tabular-nums text-neutral-muted">
                  {{ outcome.count.toLocaleString() }} · {{ formatRate(outcome.share) }}
                </span>
              </div>
              <Progress :value="outcome.share ?? 0" class="mt-1 h-2" />
              <p class="mt-1 text-xs text-neutral-muted">
                {{ $t(`analytics.outcomes.${outcome.key}.description`) }}
              </p>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>

    <p class="mt-4 text-xs text-neutral-muted">{{ $t("analytics.overview.definition") }}</p>
  </AnalyticsState>
</template>

<script setup lang="ts">
import { CheckCircle, MessageSquare, Sparkles, UserRound } from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { useAnalyticsReport } from "@/composables/useAnalyticsReport";
import { useDelta } from "@/composables/useDelta";
import { formatRate, type ReportRange } from "@/utils/analytics";
import type { RouterOutputs } from "@/types/trpc";

type Overview = RouterOutputs["analytics"]["overview"];
type Summary = Overview["current"];

const props = defineProps<{ range: ReportRange | null }>();

const report = useAnalyticsReport(
  "overview",
  () => props.range,
  (range) => HayApi.analytics.overview.query(range),
);
defineExpose({ refresh: report.refresh, refreshing: report.refreshing });

const delta = useDelta();

const EMPTY: Summary = {
  closes: 0,
  aiResolved: 0,
  handedOff: 0,
  aiResolutionRate: null,
  handoffRate: null,
  outcomes: { confirmed: 0, assumed: 0, assisted: 0, abandoned: 0, unhappy: 0, human: 0 },
};
const current = computed(() => report.data.value?.current ?? EMPTY);
const previous = computed(() => report.data.value?.previous ?? EMPTY);

const rateTrend = computed(() =>
  (report.data.value?.trend ?? []).map((day) => ({
    date: day.date,
    count: day.closes > 0 ? (day.aiResolved / day.closes) * 100 : 0,
  })),
);

// Resolved by the AI first, then what was not.
const OUTCOME_ORDER = [
  "confirmed",
  "assumed",
  "assisted",
  "human",
  "unhappy",
  "abandoned",
] as const;
const outcomes = computed(() =>
  OUTCOME_ORDER.map((key) => ({
    key,
    count: current.value.outcomes[key],
    share:
      current.value.closes > 0 ? (current.value.outcomes[key] / current.value.closes) * 100 : null,
  })),
);
</script>
