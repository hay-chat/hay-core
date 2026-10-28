<template>
  <Page :title="$t('usage.title')" :description="$t('usage.description')">
    <template #header>
      <div class="flex items-end gap-2">
        <Input
          v-model="month"
          type="select"
          :label="$t('usage.month')"
          :options="monthOptions"
          data-testid="usage-month"
        />
        <Button variant="outline" :loading="loading" @click="loadAll">
          {{ $t("usage.refresh") }}
        </Button>
      </div>
    </template>

    <Loading v-if="!summary && loading" />

    <template v-if="summary">
      <div class="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{{ $t("usage.meter.title") }}</CardTitle>
            <CardDescription>
              {{ $t("usage.meter.period", { start: periodStart, end: periodEnd }) }}
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <p class="text-4xl font-semibold tabular-nums" data-testid="usage-billable">
              {{ summary.billable }}
            </p>
            <Alert v-if="summary.agentPaused.paused" variant="warning">
              <AlertDescription>{{ $t("usage.meter.paused") }}</AlertDescription>
            </Alert>
            <p class="text-xs text-muted-foreground">{{ $t("usage.meter.periodNote") }}</p>
            <!-- TODO: core does not receive the plan allowance or overage state from the
                 billing operator; show them here once it does (no backoffice call from core). -->
            <p class="text-xs text-muted-foreground">{{ $t("usage.meter.planNote") }}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{{ $t("usage.breakdown.title") }}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl class="space-y-2 text-sm" data-testid="usage-breakdown">
              <div class="flex justify-between gap-4 font-medium">
                <dt>{{ $t("usage.breakdown.billed") }}</dt>
                <dd class="tabular-nums">{{ summary.breakdown.billed }}</dd>
              </div>
              <div
                v-if="summary.breakdown.pendingReview > 0"
                class="flex justify-between gap-4 pl-4 text-muted-foreground"
              >
                <dt>{{ $t("usage.breakdown.pendingReview") }}</dt>
                <dd class="tabular-nums">{{ summary.breakdown.pendingReview }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt>{{ $t("usage.breakdown.reversed") }}</dt>
                <dd class="tabular-nums">{{ summary.breakdown.reversed }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt>{{ $t("usage.breakdown.excluded") }}</dt>
                <dd class="tabular-nums">{{ summary.breakdown.excluded }}</dd>
              </div>
              <div class="border-t border-border pt-2 font-medium">
                {{ $t("usage.breakdown.notBilledTitle") }}
              </div>
              <div
                v-for="outcome in NOT_BILLED"
                :key="outcome"
                class="flex justify-between gap-4 text-muted-foreground"
              >
                <dt>{{ $t(`usage.breakdown.outcomes.${outcome}`) }}</dt>
                <dd class="tabular-nums">{{ summary.breakdown.notBilled[outcome] }}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div class="space-y-1.5">
            <CardTitle>{{ $t("usage.ledger.title") }}</CardTitle>
            <CardDescription>{{ $t("usage.ledger.description") }}</CardDescription>
            <p class="text-xs text-muted-foreground" data-testid="usage-exclusions">
              {{
                summary.exclusions.open
                  ? $t("usage.ledger.exclusionsUsed", {
                      used: summary.exclusions.used,
                      allowance: summary.exclusions.allowance,
                    })
                  : $t("usage.ledger.exclusionsClosed")
              }}
            </p>
          </div>
          <Button variant="outline" :loading="exporting" :disabled="total === 0" @click="exportCsv">
            <Download class="mr-2 h-4 w-4" />
            {{ $t("usage.ledger.export") }}
          </Button>
        </CardHeader>
        <CardContent>
          <p v-if="items.length === 0" class="py-12 text-center text-sm text-muted-foreground">
            {{ $t("usage.ledger.empty") }}
          </p>

          <ul v-else class="divide-y divide-border">
            <li
              v-for="item in items"
              :key="item.id"
              class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:gap-4"
              data-testid="ledger-row"
            >
              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-medium">{{ outcomeLabel(item.outcome) }}</span>
                  <Badge :variant="STATUS_VARIANT[item.status]">
                    {{ $t(`usage.ledger.statuses.${item.status}`) }}
                  </Badge>
                </div>
                <p class="text-xs text-muted-foreground">
                  {{ formatDateTime(item.closedAt) }}
                  <template v-if="item.conversationTitle"> · {{ item.conversationTitle }}</template>
                </p>
                <p v-if="item.classificationReason" class="text-xs text-muted-foreground">
                  {{ item.classificationReason }}
                </p>
                <p v-if="item.exclusionReason" class="text-xs">
                  {{ $t("usage.ledger.reasonLabel", { reason: item.exclusionReason }) }}
                  <template v-if="item.exclusionRequestedAt">
                    ·
                    {{
                      $t(
                        item.status === "excluded"
                          ? "usage.ledger.excludedBy"
                          : "usage.ledger.requestedBy",
                        {
                          who: item.exclusionRequestedBy ?? "-",
                          date: formatDateTime(item.exclusionRequestedAt),
                        },
                      )
                    }}
                  </template>
                </p>
              </div>
              <div class="flex items-center gap-3">
                <NuxtLink
                  v-if="item.conversationId"
                  :to="`/conversations/${item.conversationId}`"
                  class="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
                >
                  {{ $t("usage.ledger.openConversation") }}
                </NuxtLink>
                <span v-else class="text-xs text-muted-foreground">
                  {{ $t("usage.ledger.conversationDeleted") }}
                </span>
                <Button
                  v-if="item.status === 'billed' && summary.exclusions.open"
                  variant="outline"
                  size="sm"
                  data-testid="ledger-exclude"
                  @click="openExclude(item)"
                >
                  {{ $t("usage.ledger.exclude") }}
                </Button>
              </div>
            </li>
          </ul>

          <div
            v-if="total > PAGE_SIZE"
            class="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4"
          >
            <Button variant="outline" :disabled="page <= 1 || loading" @click="page--">
              {{ $t("usage.ledger.previous") }}
            </Button>
            <span class="text-sm text-muted-foreground">
              {{ $t("usage.ledger.pageOf", { page, pages: pageCount }) }}
            </span>
            <Button variant="outline" :disabled="page >= pageCount || loading" @click="page++">
              {{ $t("usage.ledger.next") }}
            </Button>
          </div>
        </CardContent>
      </Card>
    </template>

    <Dialog v-model:open="excludeOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ $t("usage.excludeDialog.title") }}</DialogTitle>
          <DialogDescription>
            {{
              willNeedReview
                ? $t("usage.excludeDialog.review")
                : $t("usage.excludeDialog.instant", { left: exclusionsLeft - 1 })
            }}
          </DialogDescription>
        </DialogHeader>
        <Input
          v-model="excludeReason"
          type="textarea"
          :label="$t('usage.excludeDialog.reason')"
          :placeholder="$t('usage.excludeDialog.reasonPlaceholder')"
          data-testid="ledger-exclude-reason"
        />
        <DialogFooter>
          <Button variant="outline" :disabled="excluding" @click="excludeOpen = false">
            {{ $t("common.cancel") }}
          </Button>
          <Button
            :loading="excluding"
            :disabled="excludeReason.trim().length < MIN_REASON"
            data-testid="ledger-exclude-confirm"
            @click="confirmExclude"
          >
            {{
              willNeedReview
                ? $t("usage.excludeDialog.confirmReview")
                : $t("usage.excludeDialog.confirm")
            }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { Download } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import type { RouterOutputs } from "@/types/trpc";

/**
 * Settings > Usage (D1-5, D1-6): the live count of billable resolutions for a
 * calendar month, its breakdown by outcome, and the ledger behind it with CSV
 * export and Exclude (5 % self-serve, beyond that sent to Hay.chat for review).
 */
type Summary = RouterOutputs["usage"]["summary"];
type LedgerItem = RouterOutputs["usage"]["ledger"]["items"][number];

const NOT_BILLED = ["human", "unhappy", "abandoned", "test", "spam"] as const;
const STATUS_VARIANT: Record<
  LedgerItem["status"],
  "success" | "secondary" | "warning" | "outline"
> = {
  billed: "success",
  reversed: "secondary",
  excluded: "outline",
  pending_review: "warning",
};
const PAGE_SIZE = 25;
const MIN_REASON = 3;
const MONTHS_BACK = 12;

const { t, te, locale } = useI18n();
const toast = useToast();
const { formatDateTime } = useOrgDateTime();

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

const month = ref(monthKey(new Date()));
const summary = ref<Summary | null>(null);
const items = ref<LedgerItem[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const exporting = ref(false);

const excludeOpen = ref(false);
const excludeTarget = ref<LedgerItem | null>(null);
const excludeReason = ref("");
const excluding = ref(false);

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const exclusionsLeft = computed(() =>
  summary.value
    ? Math.max(0, summary.value.exclusions.allowance - summary.value.exclusions.used)
    : 0,
);
const willNeedReview = computed(() => exclusionsLeft.value <= 0);

const monthOptions = computed(() => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat(locale.value, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return Array.from({ length: MONTHS_BACK }, (_, i) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return { label: formatter.format(date), value: monthKey(date) };
  });
});

/** Period dates are UTC calendar days; format them without a timezone shift. */
function utcDay(value: Date | string): string {
  return new Intl.DateTimeFormat(locale.value, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
const periodStart = computed(() => (summary.value ? utcDay(summary.value.period.start) : ""));
// The period end is exclusive; show the last day it covers.
const periodEnd = computed(() =>
  summary.value ? utcDay(new Date(new Date(summary.value.period.end).getTime() - 1)) : "",
);

const outcomeLabel = (outcome: string) =>
  te(`usage.ledger.outcomes.${outcome}`) ? t(`usage.ledger.outcomes.${outcome}`) : outcome;

async function loadSummary() {
  summary.value = await Hay.usage.summary.query({ month: month.value });
}

async function loadLedger() {
  const result = await Hay.usage.ledger.query({
    month: month.value,
    page: page.value,
    pageSize: PAGE_SIZE,
  });
  items.value = result.items;
  total.value = result.total;
}

async function loadAll() {
  loading.value = true;
  try {
    await Promise.all([loadSummary(), loadLedger()]);
  } catch (error) {
    toast.error(t("usage.loadFailed"), error instanceof Error ? error.message : undefined);
  } finally {
    loading.value = false;
  }
}

async function exportCsv() {
  exporting.value = true;
  try {
    const { csv } = await Hay.usage.exportCsv.mutate({ month: month.value });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hay-chat-resolutions-${month.value}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    toast.error(t("usage.ledger.exportFailed"), error instanceof Error ? error.message : undefined);
  } finally {
    exporting.value = false;
  }
}

function openExclude(item: LedgerItem) {
  excludeTarget.value = item;
  excludeReason.value = "";
  excludeOpen.value = true;
}

async function confirmExclude() {
  if (!excludeTarget.value) return;
  excluding.value = true;
  try {
    const result = await Hay.usage.exclude.mutate({
      outcomeId: excludeTarget.value.id,
      reason: excludeReason.value.trim(),
    });
    toast.success(
      result.status === "excluded"
        ? t("usage.excludeDialog.excluded")
        : t("usage.excludeDialog.sentForReview"),
    );
    excludeOpen.value = false;
    await loadAll();
  } catch (error) {
    toast.error(
      t("usage.excludeDialog.failed"),
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    excluding.value = false;
  }
}

watch(month, () => {
  if (page.value === 1) {
    void loadAll();
    return;
  }
  // The page watcher reloads the ledger.
  page.value = 1;
  void loadSummary().catch((error) =>
    toast.error(t("usage.loadFailed"), error instanceof Error ? error.message : undefined),
  );
});
watch(page, async () => {
  loading.value = true;
  try {
    await loadLedger();
  } catch (error) {
    toast.error(t("usage.loadFailed"), error instanceof Error ? error.message : undefined);
  } finally {
    loading.value = false;
  }
});

onMounted(loadAll);

useHead({ title: t("usage.headTitle") });
</script>
