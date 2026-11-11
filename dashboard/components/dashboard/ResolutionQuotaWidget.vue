<template>
  <Card v-if="summary" data-testid="resolution-quota">
    <CardHeader>
      <div class="flex items-center justify-between">
        <div>
          <CardTitle>{{ $t("dashboard.quota.title") }}</CardTitle>
          <CardDescription>
            {{ $t("dashboard.quota.period", { start: periodStart, end: periodEnd }) }}
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" @click="router.push('/settings/usage')">
          {{ $t("dashboard.quota.viewUsage") }}
          <ChevronRight class="ml-1 h-4 w-4" />
        </Button>
      </div>
    </CardHeader>
    <CardContent class="space-y-3">
      <p class="text-3xl font-bold tabular-nums text-foreground">
        <SettleValue :value="summary.billable.toLocaleString()" />
        <span v-if="included !== null" class="ml-1 text-base font-normal text-neutral-muted">
          {{ $t("dashboard.quota.ofIncluded", { included: included.toLocaleString() }) }}
        </span>
      </p>
      <Progress v-if="burnDown.usedShare !== null" :value="burnDown.usedShare" class="h-2" />
      <p class="text-sm text-neutral-muted">
        {{ $t("dashboard.quota.daysLeft", { count: burnDown.daysLeft }, burnDown.daysLeft) }}
        ·
        <span :class="burnDown.overPace ? 'text-red-600' : ''">
          {{ $t("dashboard.quota.projected", { count: burnDown.projected.toLocaleString() }) }}
        </span>
      </p>
      <p v-if="included === null" class="text-xs text-neutral-muted">
        {{ $t("dashboard.quota.noQuota") }}
      </p>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ChevronRight } from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { quotaBurnDown } from "@/utils/analytics";
import { formatShortDate } from "@/utils/date";

/**
 * Billable resolutions in the current billing period against what the plan
 * includes. Usage is owner/admin only, so the parent renders this for them.
 */
const router = useRouter();

const query = useCachedQuery(
  () => ["usage", "summary", 0] as const,
  () => HayApi.usage.summary.query({ period: 0 }),
);
defineExpose({ refresh: query.refresh });

const summary = computed(() => query.data.value ?? null);
const included = computed(() => summary.value?.includedResolutions ?? null);
const periodStart = computed(() => formatShortDate(summary.value?.period.start));
// The period's end is exclusive; show its last day.
const periodEnd = computed(() =>
  summary.value ? formatShortDate(new Date(new Date(summary.value.period.end).getTime() - 1)) : "",
);

const burnDown = computed(() =>
  quotaBurnDown({
    billable: summary.value?.billable ?? 0,
    included: included.value,
    start: new Date(summary.value?.period.start ?? Date.now()),
    end: new Date(summary.value?.period.end ?? Date.now()),
  }),
);
</script>
