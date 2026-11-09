<template>
  <Card class="cursor-pointer" @click="openEscalations">
    <CardHeader>
      <div class="flex items-center justify-between">
        <div>
          <CardTitle>Human escalations</CardTitle>
          <CardDescription>Takeovers logged from “Join”</CardDescription>
        </div>
        <div class="flex items-center gap-2">
          <RefreshIndicator :active="isRefreshing" />
          <ChevronRight class="h-4 w-4 text-neutral-muted" />
        </div>
      </div>
    </CardHeader>
    <CardContent>
      <div class="grid grid-cols-2 gap-3">
        <div class="p-3 border rounded-lg">
          <div class="text-sm text-neutral-muted">Today</div>
          <div
            v-if="!statsToday"
            class="my-1 h-6 w-10 animate-pulse rounded bg-background-tertiary motion-reduce:animate-none"
          />
          <div v-else class="text-2xl font-bold text-foreground">
            <SettleValue :value="statsToday.totalEscalations" />
          </div>
          <div v-if="statsToday?.percentage != null" class="text-xs text-neutral-muted mt-1">
            {{ statsToday.percentage.toFixed(1) }}% of conversations
          </div>
        </div>

        <div class="p-3 border rounded-lg">
          <div class="text-sm text-neutral-muted">This week</div>
          <div
            v-if="!statsWeek"
            class="my-1 h-6 w-10 animate-pulse rounded bg-background-tertiary motion-reduce:animate-none"
          />
          <div v-else class="text-2xl font-bold text-foreground">
            <SettleValue :value="statsWeek.totalEscalations" />
          </div>
          <div v-if="statsWeek?.percentage != null" class="text-xs text-neutral-muted mt-1">
            {{ statsWeek.percentage.toFixed(1) }}% of conversations
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { HayApi } from "@/utils/api";
import { ChevronRight } from "lucide-vue-next";

const router = useRouter();

const useEscalations = (period: "today" | "week") =>
  useCachedQuery(
    () => ["conversations", "escalations", period] as const,
    ([, , range]) => HayApi.conversations.escalations.query({ period: range }),
  );

const today = useEscalations("today");
const week = useEscalations("week");

const statsToday = computed(() => today.data.value ?? null);
const statsWeek = computed(() => week.data.value ?? null);
const isRefreshing = computed(() => today.refreshing.value || week.refreshing.value);

const openEscalations = () => {
  router.push({
    path: "/conversations",
    query: { escalationsPeriod: "today" },
  });
};

let pollTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  pollTimer = setInterval(() => {
    void today.refresh();
    void week.refresh();
  }, 30_000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>
