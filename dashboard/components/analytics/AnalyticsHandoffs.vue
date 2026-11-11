<template>
  <AnalyticsState
    :loading="report.loading.value"
    :failed="report.failed.value"
    :empty="current.handedOff === 0"
    :empty-title="$t('analytics.handoffs.emptyTitle')"
    :empty-description="$t('analytics.handoffs.emptyDescription')"
    @retry="report.refresh()"
  >
    <div class="grid gap-4 mb-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        :title="$t('analytics.handoffs.rate')"
        :icon="UserRound"
        :metric="formatRate(current.handoffRate)"
        :format-metric="false"
        v-bind="delta(current.handoffRate, previous.handoffRate, 'points', false)"
      />
      <MetricCard
        v-for="category in CATEGORIES"
        :key="category.key"
        :title="$t(`analytics.handoffs.categories.${category.key}.label`)"
        :icon="category.icon"
        :metric="current.categories[category.key]"
        v-bind="
          delta(
            current.categories[category.key],
            previous.categories[category.key],
            'percent',
            category.higherIsBetter,
          )
        "
      />
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("analytics.handoffs.reasonsTitle") }}</CardTitle>
          <CardDescription>{{ $t("analytics.handoffs.reasonsDescription") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{{ $t("analytics.handoffs.columns.reason") }}</TableHead>
                <TableHead>{{ $t("analytics.handoffs.columns.category") }}</TableHead>
                <TableHead class="!text-right">
                  {{ $t("analytics.handoffs.columns.count") }}
                </TableHead>
                <TableHead class="!text-right">
                  {{ $t("analytics.handoffs.columns.share") }}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in reasons" :key="row.reason">
                <TableCell>
                  <p class="font-medium text-foreground">
                    {{ $t(`analytics.handoffs.reasons.${row.reason}.label`) }}
                  </p>
                  <p class="text-xs text-neutral-muted">
                    {{ $t(`analytics.handoffs.reasons.${row.reason}.description`) }}
                  </p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {{ $t(`analytics.handoffs.categories.${row.category}.label`) }}
                  </Badge>
                </TableCell>
                <TableCell class="text-right tabular-nums">
                  {{ row.count.toLocaleString() }}
                </TableCell>
                <TableCell class="text-right tabular-nums">{{ formatRate(row.share) }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{{ $t("analytics.handoffs.trendTitle") }}</CardTitle>
          <CardDescription>{{ $t("analytics.handoffs.trendDescription") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <LineChart :data="trend" :height="280" :label="$t('analytics.handoffs.title')" />
        </CardContent>
      </Card>
    </div>

    <p v-if="current.categories.not_recorded > 0" class="mt-4 text-xs text-neutral-muted">
      {{ $t("analytics.handoffs.notRecordedNote", { count: current.categories.not_recorded }) }}
    </p>
  </AnalyticsState>
</template>

<script setup lang="ts">
import { BookOpenCheck, Hand, ShieldAlert, UserRound } from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { useAnalyticsReport } from "@/composables/useAnalyticsReport";
import { useDelta } from "@/composables/useDelta";
import { formatRate, type ReportRange } from "@/utils/analytics";
import type { RouterOutputs } from "@/types/trpc";

type Summary = RouterOutputs["analytics"]["handoffs"]["current"];

const props = defineProps<{ range: ReportRange | null }>();

const report = useAnalyticsReport(
  "handoffs",
  () => props.range,
  (range) => HayApi.analytics.handoffs.query(range),
);
defineExpose({ refresh: report.refresh, refreshing: report.refreshing });

const delta = useDelta();

// A planned hand-off is the playbook working; more fallbacks is the AI falling short.
const CATEGORIES = [
  { key: "planned", icon: BookOpenCheck, higherIsBetter: true },
  { key: "customer_asked", icon: Hand, higherIsBetter: false },
  { key: "fallback", icon: ShieldAlert, higherIsBetter: false },
] as const;

const EMPTY: Summary = {
  closes: 0,
  handedOff: 0,
  handoffRate: null,
  categories: { planned: 0, customer_asked: 0, fallback: 0, not_recorded: 0 },
};
const current = computed(() => report.data.value?.current ?? EMPTY);
const previous = computed(() => report.data.value?.previous ?? EMPTY);
const reasons = computed(() => report.data.value?.reasons ?? []);

const trend = computed(() =>
  (report.data.value?.trend ?? []).map((day) => ({
    date: day.date,
    count: day.planned + day.customer_asked + day.fallback + day.not_recorded,
  })),
);
</script>
