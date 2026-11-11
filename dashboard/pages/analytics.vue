<template>
  <Page :title="$t('analytics.page.title')" :description="$t('analytics.page.description')">
    <template #header>
      <div class="flex gap-4">
        <RefreshIndicator :active="!!activeReport?.refreshing" class="self-center" />
        <DateRangeSelector v-model="dateRange" />
        <Button variant="outline" @click="activeReport?.refresh()">
          <RefreshCw class="mr-2 h-4 w-4" />
          {{ $t("analytics.actions.refresh") }}
        </Button>
        <Button
          v-if="userStore.isAdmin"
          variant="outline"
          :loading="exporting"
          :disabled="!range"
          data-testid="analytics-export"
          @click="exportCsv"
        >
          <Download class="mr-2 h-4 w-4" />
          {{ $t("analytics.actions.export") }}
        </Button>
      </div>
    </template>

    <Tabs v-model="tab" :default-value="tab">
      <TabsList>
        <TabsTrigger v-for="name in TABS" :key="name" :value="name">
          {{ $t(`analytics.tabs.${name}`) }}
        </TabsTrigger>
      </TabsList>

      <p class="pt-4 text-xs text-neutral-muted">{{ $t("analytics.comparisonNote") }}</p>

      <TabsContent value="overview">
        <AnalyticsOverview ref="activeReport" :range="range" />
      </TabsContent>
      <TabsContent value="csat">
        <AnalyticsCsat ref="activeReport" :range="range" />
      </TabsContent>
      <TabsContent value="handoffs">
        <AnalyticsHandoffs ref="activeReport" :range="range" />
      </TabsContent>
      <TabsContent value="topics">
        <AnalyticsTopics ref="activeReport" :range="range" />
      </TabsContent>
      <TabsContent value="playbooks">
        <AnalyticsPlaybooks ref="activeReport" :range="range" />
      </TabsContent>
    </Tabs>
  </Page>
</template>

<script setup lang="ts">
import { Download, RefreshCw } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { downloadCsv, type ReportRange } from "@/utils/analytics";
import { toISODateRange } from "@/utils/date";
import { useToast } from "@/composables/useToast";
import { useUserStore } from "@/stores/user";

const TABS = ["overview", "csat", "handoffs", "topics", "playbooks"] as const;
type Tab = (typeof TABS)[number];

const { t } = useI18n();
const toast = useToast();
const userStore = useUserStore();

const tab = ref<Tab>("overview");
// Only the open tab is mounted, so one ref follows whichever report is showing.
const activeReport = ref<{ refresh: () => Promise<void>; refreshing: boolean } | null>(null);

// The selector fills this in on mount; the reports wait for it.
const dateRange = ref({ startDate: "", endDate: "" });
const range = computed<ReportRange | null>(() => {
  const { startDate, endDate } = toISODateRange(dateRange.value);
  return startDate && endDate ? { startDate, endDate } : null;
});

const exporting = ref(false);
async function exportCsv() {
  if (!range.value) return;
  exporting.value = true;
  try {
    const { csv } = await Hay.analytics.exportCsv.mutate({ ...range.value, report: tab.value });
    downloadCsv(csv, `hay-chat-${tab.value}-${dateRange.value.startDate}.csv`);
  } catch (error) {
    toast.error(t("analytics.exportFailed"), error instanceof Error ? error.message : undefined);
  } finally {
    exporting.value = false;
  }
}

useHead({ title: t("analytics.page.seoTitle") });
</script>
