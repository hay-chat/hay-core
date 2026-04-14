<template>
  <Card class="cursor-pointer" @click="openEscalations">
    <CardHeader>
      <div class="flex items-center justify-between">
        <div>
          <CardTitle>Human escalations</CardTitle>
          <CardDescription>Takeovers logged from “Join”</CardDescription>
        </div>
        <ChevronRight class="h-4 w-4 text-neutral-muted" />
      </div>
    </CardHeader>
    <CardContent>
      <div class="grid grid-cols-2 gap-3">
        <div class="p-3 border rounded-lg">
          <div class="text-sm text-neutral-muted">Today</div>
          <div class="text-2xl font-bold text-foreground">
            {{ statsToday?.totalEscalations ?? 0 }}
          </div>
          <div v-if="statsToday?.percentage != null" class="text-xs text-neutral-muted mt-1">
            {{ statsToday.percentage.toFixed(1) }}% of conversations
          </div>
        </div>

        <div class="p-3 border rounded-lg">
          <div class="text-sm text-neutral-muted">This week</div>
          <div class="text-2xl font-bold text-foreground">
            {{ statsWeek?.totalEscalations ?? 0 }}
          </div>
          <div v-if="statsWeek?.percentage != null" class="text-xs text-neutral-muted mt-1">
            {{ statsWeek.percentage.toFixed(1) }}% of conversations
          </div>
        </div>
      </div>

      <div v-if="isRefreshing" class="mt-3 text-center">
        <RefreshCw class="h-4 w-4 inline animate-spin text-neutral-muted" />
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { HayApi } from "@/utils/api";
import { useAnalyticsStore } from "@/stores/analytics";
import { ChevronRight, RefreshCw } from "lucide-vue-next";

type EscalationStats = {
  period: "today" | "week";
  totalEscalations: number;
  totalConversations: number;
  conversationsWithEscalation: number;
  percentage: number | null;
  window: { start: string; end: string };
};

const router = useRouter();
const analyticsStore = useAnalyticsStore();

const CACHE_KEY_TODAY = "dashboard_escalations_today";
const CACHE_KEY_WEEK = "dashboard_escalations_week";
const CACHE_TTL = 30 * 1000;

const statsToday = ref<EscalationStats | null>(null);
const statsWeek = ref<EscalationStats | null>(null);

const isRefreshing = computed(() => {
  return (
    analyticsStore.isWidgetRefreshing(CACHE_KEY_TODAY) ||
    analyticsStore.isWidgetRefreshing(CACHE_KEY_WEEK)
  );
});

const fetchStats = async (forceRefresh = false) => {
  const [today, week] = await Promise.all([
    analyticsStore.fetchData(
      CACHE_KEY_TODAY,
      () => HayApi.conversations.escalations.query({ period: "today" }),
      { ttl: CACHE_TTL, forceRefresh },
    ),
    analyticsStore.fetchData(
      CACHE_KEY_WEEK,
      () => HayApi.conversations.escalations.query({ period: "week" }),
      { ttl: CACHE_TTL, forceRefresh },
    ),
  ]);
  statsToday.value = (today as any) || null;
  statsWeek.value = (week as any) || null;
};

const openEscalations = () => {
  router.push({
    path: "/conversations",
    query: { escalationsPeriod: "today" },
  });
};

let pollTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await fetchStats(false);
  pollTimer = setInterval(() => fetchStats(true), 30_000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

