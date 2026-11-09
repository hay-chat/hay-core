<template>
  <Page :title="$t('dashboard.page.title')" :description="$t('dashboard.page.description')">
    <template #header>
      <div class="flex gap-4">
        <RefreshIndicator :active="refreshing" class="self-center" />
        <DateRangeSelector v-model="dateRange" />
        <Button variant="outline" :disabled="refreshing" @click="refreshData">
          <RefreshCw class="mr-2 h-4 w-4" />
          {{ $t("dashboard.actions.refresh") }}
        </Button>
      </div>
    </template>

    <!-- Key Metrics Cards -->
    <div class="grid gap-4 mb-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        :title="$t('dashboard.metrics.totalConversations')"
        :icon="MessageSquare"
        :metric="conversationMetrics.totalConversations"
        :subtitle="`${conversationMetrics.resolvedConversations}`"
        :subtitle-suffix="$t('dashboard.metrics.resolved')"
        subtitle-color="green"
        :loading="!metricsQuery.data.value"
      />

      <MetricCard
        :title="$t('dashboard.metrics.resolutionRate')"
        :icon="CheckCircle"
        :metric="`${conversationMetrics.resolutionRate.toFixed(1)}%`"
        :subtitle="$t('dashboard.metrics.ofConversations')"
        :subtitle-suffix="$t('dashboard.metrics.resolved')"
        subtitle-color="green"
        :format-metric="false"
        :loading="!metricsQuery.data.value"
      />

      <MetricCard
        :title="$t('dashboard.metrics.avgMessages')"
        :icon="MessageCircle"
        :metric="conversationMetrics.avgMessagesPerConversation.toFixed(1)"
        :subtitle="$t('dashboard.metrics.messagesPer')"
        :subtitle-suffix="$t('dashboard.metrics.conversation')"
        :format-metric="false"
        :loading="!metricsQuery.data.value"
      />

      <MetricCard
        :title="$t('dashboard.metrics.avgResponseTime')"
        :icon="Clock"
        :metric="
          responseTime.sampleSize > 0 ? formatWaitTime(responseTime.averageResponseTime) : '—'
        "
        :subtitle="
          responseTime.sampleSize > 0
            ? $t('dashboard.metrics.medianResponseTime', {
                value: formatWaitTime(responseTime.medianResponseTime),
              })
            : $t('dashboard.metrics.noRepliesYet')
        "
        :format-metric="false"
        :loading="!responseTimeQuery.data.value"
      />
    </div>

    <!-- Charts and Activity -->
    <div class="grid gap-4 mb-4 md:grid-cols-2">
      <!-- Activity Chart -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("dashboard.activity.title") }}</CardTitle>
          <CardDescription>{{ $t("dashboard.activity.description") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="">
            <template v-if="conversationStats.length > 0">
              <div class="chart-wrapper">
                <LineChart :data="conversationStats" :colors="['#001df5']" :height="300" />
              </div>
            </template>
            <div
              v-else-if="!activityQuery.data.value"
              class="h-full flex items-center justify-center bg-background-secondary rounded-lg"
            >
              <Loading />
            </div>
            <div v-else class="text-center py-8 text-neutral-muted">
              <p>{{ $t("dashboard.activity.empty") }}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Recent Activity -->
      <!-- <Card class="lg:col-span-3">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription> Latest updates from your organization </CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <div
              v-for="activity in _recentActivity"
              :key="activity.id"
              class="flex items-start space-x-3"
            >
              <div class="flex-shrink-0">
                <component
                  :is="activity.icon"
                  :class="[
                    'h-5 w-5',
                    activity.type === 'success'
                      ? 'text-green-500'
                      : activity.type === 'warning'
                        ? 'text-yellow-500'
                        : activity.type === 'error'
                          ? 'text-red-500'
                          : 'text-blue-500',
                  ]"
                />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-foreground">
                  {{ activity.title }}
                </p>
                <p class="text-sm text-neutral-muted">
                  {{ activity.description }}
                </p>
                <p class="text-xs text-neutral-muted mt-1">
                  {{ formatTimeAgo(activity.timestamp) }}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card> -->

      <!-- Recent Conversations -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>{{ $t("dashboard.recentConversations.title") }}</CardTitle>
              <CardDescription>{{
                $t("dashboard.recentConversations.description")
              }}</CardDescription>
            </div>
            <Button variant="ghost" size="sm" @click="viewAllConversations">
              {{ $t("dashboard.actions.viewAll") }}
              <ChevronRight class="ml-1 h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div v-if="!recentQuery.data.value" class="space-y-4">
            <div
              v-for="i in 4"
              :key="i"
              class="h-[66px] animate-pulse rounded-lg bg-background-tertiary motion-reduce:animate-none"
            />
          </div>
          <div v-else-if="recentConversations.length > 0" class="space-y-4">
            <div
              v-for="conversation in recentConversations"
              :key="conversation.id"
              class="flex items-center justify-between p-3 border rounded-lg hover:bg-background-secondary transition-colors cursor-pointer gap-2"
              :class="{ 'data-settle': isNewRecent(conversation.id) }"
              @click="viewConversation(conversation.id)"
            >
              <div
                class="h-8 w-8 rounded-full bg-background-tertiary flex items-center justify-center"
              >
                <User class="h-4 w-4 text-neutral-muted" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-foreground truncate">
                  {{ conversation.customerName }}
                </p>
                <p class="text-sm text-neutral-muted truncate">
                  {{ conversation.lastMessage }}
                </p>
              </div>
              <div class="text-right flex-shrink-0">
                <div
                  :class="[
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    conversation.status === 'resolved'
                      ? 'bg-green-100 text-green-800'
                      : conversation.status === 'active'
                        ? 'bg-blue-100 text-blue-800'
                        : conversation.status === 'escalated'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-800',
                  ]"
                >
                  {{ conversation.status }}
                </div>
                <div class="text-xs text-neutral-muted mt-1">
                  {{ formatTimeAgo(conversation.updatedAt) }}
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-center py-8 text-neutral-muted">
            <MessageSquare class="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>{{ $t("dashboard.recentConversations.emptyTitle") }}</p>
            <p class="text-sm mt-2">{{ $t("dashboard.recentConversations.emptyDescription") }}</p>
          </div>
        </CardContent>
      </Card>
      <!-- Active Conversations (Live) -->
      <ActiveConversationsWidget />
      <!-- Escalations -->
      <EscalationsWidget />
      <!-- Attention Needed Conversations -->
      <AttentionNeededWidget />

      <!-- Sentiment Score Gauge -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("dashboard.sentiment.scoreTitle") }}</CardTitle>
          <CardDescription>{{ $t("dashboard.sentiment.scorePeriod") }}</CardDescription>
        </CardHeader>
        <CardContent class="flex align-center justify-center">
          <div
            v-if="!sentimentQuery.data.value"
            class="h-48 w-full animate-pulse rounded-lg bg-background-tertiary motion-reduce:animate-none"
          />
          <SimpleGauge
            v-else
            :title="$t('dashboard.sentiment.scoreTitle')"
            :subtitle="$t('dashboard.sentiment.scorePeriod')"
            :counts="sentimentCounts"
            :show-breakdown="true"
          />
        </CardContent>
      </Card>

      <!-- Sentiment Breakdown -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("dashboard.sentiment.breakdownTitle") }}</CardTitle>
          <CardDescription>{{ $t("dashboard.sentiment.breakdownDescription") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <div v-if="!sentimentQuery.data.value" class="space-y-4">
            <div
              v-for="i in 3"
              :key="i"
              class="h-[74px] animate-pulse rounded-lg bg-background-tertiary motion-reduce:animate-none"
            />
          </div>
          <div v-else-if="sentimentBreakdown.length > 0" class="space-y-4">
            <div
              v-for="sentiment in sentimentBreakdown"
              :key="sentiment.type"
              class="flex items-center justify-between p-4 border rounded-lg"
              :class="sentiment.bgClass"
            >
              <div class="flex items-center space-x-3">
                <component :is="sentiment.icon" :class="['h-8 w-8', sentiment.iconClass]" />
                <div>
                  <p class="font-medium text-foreground capitalize">{{ sentiment.type }}</p>
                  <p class="text-sm text-muted-foreground">
                    {{ $t("dashboard.sentiment.messages", { count: sentiment.count }) }}
                  </p>
                </div>
              </div>
              <div class="text-right">
                <div class="text-2xl font-bold text-foreground">
                  <SettleValue :value="`${sentiment.percentage.toFixed(1)}%`" />
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-center py-8 text-muted-foreground">
            <Smile class="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>{{ $t("dashboard.sentiment.emptyTitle") }}</p>
            <p class="text-sm mt-2">{{ $t("dashboard.sentiment.emptyDescription") }}</p>
          </div>
        </CardContent>
      </Card>

      <!-- Document Status Overview -->
      <DocumentStatsWidget ref="documentStatsWidget" />
    </div>
  </Page>
</template>

<script setup lang="ts">
import {
  MessageSquare,
  CheckCircle,
  User,
  RefreshCw,
  ChevronRight,
  MessageCircle,
  Smile,
  Meh,
  Frown,
  Clock,
} from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { formatWaitTime } from "@/utils/conversation";
import { toISODateRange } from "@/utils/date";
import type { RouterOutputs } from "@/types/trpc";

// State
const { t } = useI18n();
const router = useRouter();
const documentStatsWidget = ref<{ refresh: () => void } | null>(null);

// The selector fills this in on mount; queries wait for it.
const dateRange = ref({
  startDate: "",
  endDate: "",
});

interface DateKey {
  startDate: string;
  endDate: string;
}
const analyticsKey = <N extends string>(name: N) => {
  const { startDate, endDate } = dateRange.value;
  return startDate ? (["analytics", name, { startDate, endDate } as DateKey] as const) : null;
};

interface Conversation {
  id: string;
  title?: string;
  status: string;
  created_at: string;
  updated_at: string;
  messages?: Array<{ content: string; created_at: string }>;
  organization?: unknown;
  metadata?: Record<string, unknown> | null;
}

interface ConversationStat {
  date: string;
  count: number;
  label: string;
  chartIndex?: number;
}

const recentQuery = useCachedQuery(
  () => ["conversations", "list", "dashboard-recent"] as const,
  async () => {
    const response = await HayApi.conversations.list.query({
      pagination: { page: 1, limit: 10 },
      include: ["messages"],
    });
    return response.items as unknown as Conversation[];
  },
);
const conversations = computed(() => recentQuery.data.value ?? []);

const activityQuery = useCachedQuery(
  () => analyticsKey("conversationActivity"),
  ([, , range]) => HayApi.analytics.conversationActivity.query(toISODateRange(range)),
);
const sentimentQuery = useCachedQuery(
  () => analyticsKey("sentimentAnalysis"),
  ([, , range]) => HayApi.analytics.sentimentAnalysis.query(toISODateRange(range)),
);
const metricsQuery = useCachedQuery(
  () => analyticsKey("conversationMetrics"),
  ([, , range]) => HayApi.analytics.conversationMetrics.query(toISODateRange(range)),
);
const responseTimeQuery = useCachedQuery(
  () => analyticsKey("responseTime"),
  ([, , range]) => HayApi.analytics.responseTime.query(toISODateRange(range)),
);
const queries = [recentQuery, activityQuery, sentimentQuery, metricsQuery, responseTimeQuery];

const refreshing = computed(() => queries.some((query) => query.refreshing.value));

// The chart needs numeric counts and a numeric x-axis index.
const conversationStats = computed<ConversationStat[]>(() =>
  ((activityQuery.data.value?.data ?? []) as ConversationStat[]).map((item, index) => ({
    ...item,
    chartIndex: index,
    count: Number(item.count) || 0,
  })),
);

type SentimentRow = { sentiment: string; count: number; percentage: number };
const sentimentData = computed(() => (sentimentQuery.data.value?.data ?? []) as SentimentRow[]);

const conversationMetrics = computed(() => {
  const metrics = (metricsQuery.data.value?.data ?? {}) as Partial<Record<string, number>>;
  return {
    totalConversations: metrics.totalConversations ?? 0,
    resolvedConversations: metrics.resolvedConversations ?? 0,
    resolutionRate: metrics.resolutionRate ?? 0,
    avgMessagesPerConversation: metrics.avgMessagesPerConversation ?? 0,
  };
});

type ResponseTime = RouterOutputs["analytics"]["responseTime"]["data"];
const responseTime = computed<ResponseTime>(
  () =>
    responseTimeQuery.data.value?.data ?? {
      averageResponseTime: 0,
      medianResponseTime: 0,
      p95ResponseTime: 0,
      sampleSize: 0,
    },
);

const isNewRecent = useNewRows(() => recentQuery.data.value, recentQuery.keyHash);

// Computed property for sentiment gauge counts
const sentimentCounts = computed(() => {
  const counts = { pos: 0, neu: 0, neg: 0 };

  sentimentData.value.forEach((item) => {
    if (item.sentiment === "positive") {
      counts.pos = item.count;
    } else if (item.sentiment === "neutral") {
      counts.neu = item.count;
    } else if (item.sentiment === "negative") {
      counts.neg = item.count;
    }
  });

  return counts;
});

const sentimentBreakdown = computed(() => {
  const sentimentMap = {
    positive: {
      type: "positive",
      icon: Smile,
      iconClass: "text-green-600",
      bgClass: "bg-green-50 border-green-200",
    },
    neutral: {
      type: "neutral",
      icon: Meh,
      iconClass: "text-yellow-600",
      bgClass: "bg-yellow-50 border-yellow-200",
    },
    negative: {
      type: "negative",
      icon: Frown,
      iconClass: "text-red-600",
      bgClass: "bg-red-50 border-red-200",
    },
  };

  return sentimentData.value.map((item) => ({
    ...sentimentMap[item.sentiment as keyof typeof sentimentMap],
    count: item.count,
    percentage: item.percentage,
  }));
});

// Computed property for recent conversations
const recentConversations = computed(() => {
  return conversations.value
    .slice(0, 4) // Get 4 most recent
    .map((conv) => {
      // Get the last message by created_at (join order is not guaranteed)
      const lastMessage =
        conv.messages && conv.messages.length > 0
          ? [...conv.messages].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
            )[conv.messages.length - 1]
          : null;

      return {
        id: conv.id,
        customerName: conv.title || "New Conversation",
        lastMessage: lastMessage ? lastMessage.content.substring(0, 50) + "..." : "No messages yet",
        status: conv.status || "active",
        updatedAt: new Date(conv.updated_at || conv.created_at),
      };
    });
});

// Methods
const formatTimeAgo = (date: Date) => {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return t("dashboard.timeAgo.justNow");
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return t("dashboard.timeAgo.minutesAgo", { count: minutes });
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return t("dashboard.timeAgo.hoursAgo", { count: hours });
  } else {
    const days = Math.floor(diffInSeconds / 86400);
    return t("dashboard.timeAgo.daysAgo", { count: days });
  }
};

const refreshData = () => {
  queries.forEach((query) => void query.refresh());
  documentStatsWidget.value?.refresh();
};

const viewAllConversations = () => {
  router.push("/conversations");
};

const viewConversation = (id: string) => {
  router.push(`/conversations/${id}`);
};

// TODO: Set up WebSocket listeners for real-time updates
// TODO: Implement data refresh intervals
// TODO: Add error handling and retry logic
// TODO: Add accessibility improvements
// TODO: Implement keyboard navigation

// SEO
useHead({
  title: t("dashboard.page.seoTitle"),
  meta: [
    {
      name: "description",
      content: t("dashboard.page.seoDescription"),
    },
  ],
});
</script>
