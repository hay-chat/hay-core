<template>
  <Page title="Dashboard" description="Welcome back! Here's what's happening with your AI agents.">
    <template #header>
      <div class="flex gap-4">
        <DateRangeSelector v-model="dateRange" @change="refreshData" />
        <Button variant="outline" :disabled="loading" @click="refreshData">
          <RefreshCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': loading }" />
          Refresh
        </Button>
      </div>
    </template>

    <!-- Key Metrics Cards -->
    <div class="grid gap-4 mb-4 md:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="Active Agents"
        :icon="Bot"
        :metric="metrics.activeAgents"
        :subtitle="`+${metrics.newAgentsThisWeek}`"
        subtitle-suffix="new this week"
        subtitle-color="green"
        :show-cache-indicator="false"
        :cache-age="analyticsStore.formatDataAge(CACHE_KEYS.AGENTS)"
      />

      <MetricCard
        title="Total Conversations"
        :icon="MessageSquare"
        :metric="conversationMetrics.totalConversations"
        :subtitle="`${conversationMetrics.resolvedConversations}`"
        subtitle-suffix="resolved"
        subtitle-color="green"
        :show-cache-indicator="false"
        :cache-age="analyticsStore.formatDataAge(CACHE_KEYS.METRICS)"
      />

      <MetricCard
        title="Resolution Rate"
        :icon="CheckCircle"
        :metric="`${conversationMetrics.resolutionRate.toFixed(1)}%`"
        subtitle="of conversations"
        subtitle-suffix="resolved"
        subtitle-color="green"
        :format-metric="false"
        :show-cache-indicator="false"
        :cache-age="analyticsStore.formatDataAge(CACHE_KEYS.METRICS)"
      />

      <MetricCard
        title="Avg Messages"
        :icon="MessageCircle"
        :metric="conversationMetrics.avgMessagesPerConversation.toFixed(1)"
        subtitle="messages per"
        subtitle-suffix="conversation"
        :format-metric="false"
        :show-cache-indicator="false"
        :cache-age="analyticsStore.formatDataAge(CACHE_KEYS.METRICS)"
      />
    </div>

    <!-- Charts and Activity -->
    <div class="grid gap-4 mb-4 md:grid-cols-2">
      <!-- Activity Chart -->
      <Card>
        <CardHeader>
          <CardTitle>Conversation Activity</CardTitle>
          <CardDescription>Daily conversation volume</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="">
            <template v-if="conversationStats.length > 0">
              <div class="chart-wrapper">
                <LineChart :data="conversationStats" :colors="['#001df5']" :height="300" />
              </div>
            </template>
            <div
              v-else
              class="h-full flex items-center justify-center bg-background-secondary rounded-lg"
            >
              <Loading />
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
              v-for="activity in recentActivity"
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

      <!-- Top Performing Agents -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>Top Performing Agents</CardTitle>
              <CardDescription> Best agents by resolution rate this month </CardDescription>
            </div>
            <Button variant="ghost" size="sm" @click="viewAllAgents">
              View All
              <ChevronRight class="ml-1 h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div v-if="topAgents.length > 0" class="space-y-4">
            <div
              v-for="agent in topAgents"
              :key="agent.id"
              class="flex items-center justify-between p-3 border rounded-lg hover:bg-background-secondary transition-colors"
            >
              <div class="flex items-center space-x-3">
                <div class="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot class="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p class="font-medium text-foreground">
                    {{ agent.name }}
                  </p>
                  <p class="text-sm text-neutral-muted">{{ agent.conversations }} conversations</p>
                </div>
              </div>
              <div class="text-right">
                <div class="text-sm font-medium text-foreground">{{ agent.resolutionRate }}%</div>
                <div class="text-xs text-neutral-muted">resolution rate</div>
              </div>
            </div>
          </div>
          <div v-else class="text-center py-8 text-neutral-muted">
            <Bot class="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No agents created yet</p>
            <Button variant="outline" size="sm" class="mt-4" @click="createAgent">
              Create Your First Agent
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- Recent Conversations -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>Recent Conversations</CardTitle>
              <CardDescription> Latest customer interactions </CardDescription>
            </div>
            <Button variant="ghost" size="sm" @click="viewAllConversations">
              View All
              <ChevronRight class="ml-1 h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div v-if="recentConversations.length > 0" class="space-y-4">
            <div
              v-for="conversation in recentConversations"
              :key="conversation.id"
              class="flex items-center justify-between p-3 border rounded-lg hover:bg-background-secondary transition-colors cursor-pointer"
              @click="viewConversation(conversation.id)"
            >
              <div class="flex items-center space-x-3">
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
            <p>No conversations yet</p>
            <p class="text-sm mt-2">Start chatting with your agents to see conversations here</p>
          </div>
        </CardContent>
      </Card>
      <!-- Sentiment Score Gauge -->
      <Card>
        <CardHeader>
          <CardTitle>Customer Sentiment Score</CardTitle>
          <CardDescription>Last 30 days</CardDescription>
        </CardHeader>
        <CardContent class="flex align-center justify-center">
          <SimpleGauge
            title="Customer Sentiment Score"
            subtitle="Last 30 days"
            :counts="sentimentCounts"
            :show-breakdown="true"
            :show-view-report="true"
            @view-report="viewInsights"
          />
        </CardContent>
      </Card>

      <!-- Sentiment Breakdown -->
      <Card>
        <CardHeader>
          <CardTitle>Sentiment Breakdown</CardTitle>
          <CardDescription>Detailed analysis by sentiment type</CardDescription>
        </CardHeader>
        <CardContent>
          <div v-if="sentimentBreakdown.length > 0" class="space-y-4">
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
                  <p class="text-sm text-muted-foreground">{{ sentiment.count }} messages</p>
                </div>
              </div>
              <div class="text-right">
                <div class="text-2xl font-bold text-foreground">
                  {{ sentiment.percentage.toFixed(1) }}%
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-center py-8 text-muted-foreground">
            <Smile class="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No sentiment data yet</p>
            <p class="text-sm mt-2">Analysis will appear as messages are processed</p>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Quick Actions -->
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription> Common tasks to help you manage your AI agents </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Button variant="outline" class="h-20 flex-col space-y-2" @click="createAgent">
            <Bot class="h-6 w-6" />
            <span>Create Agent</span>
          </Button>
          <Button variant="outline" class="h-20 flex-col space-y-2" @click="viewInsights">
            <Lightbulb class="h-6 w-6" />
            <span>View Insights</span>
          </Button>
          <Button variant="outline" class="h-20 flex-col space-y-2" @click="managePlaybooks">
            <BookOpen class="h-6 w-6" />
            <span>Manage Playbooks</span>
          </Button>
          <Button variant="outline" class="h-20 flex-col space-y-2" @click="scrollToTop">
            <BarChart3 class="h-6 w-6" />
            <span>View Dashboard</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import {
  Bot,
  MessageSquare,
  CheckCircle,
  BarChart3,
  User,
  Plus,
  RefreshCw,
  ChevronRight,
  Lightbulb,
  BookOpen,
  AlertCircle,
  Zap,
  MessageCircle,
  Smile,
  Meh,
  Frown,
} from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { useAnalyticsStore } from "@/stores/analytics";

// State
const loading = ref(false);
const router = useRouter();
const analyticsStore = useAnalyticsStore();

// Cache keys for different widgets
const CACHE_KEYS = {
  AGENTS: "dashboard_agents",
  CONVERSATIONS: "dashboard_conversations",
  ACTIVITY: "dashboard_activity",
  SENTIMENT: "dashboard_sentiment",
  METRICS: "dashboard_metrics",
};

// TTL values in milliseconds
const CACHE_TTL = {
  AGENTS: 5 * 60 * 1000, // 5 minutes
  CONVERSATIONS: 1 * 60 * 1000, // 1 minute for recent conversations
  ACTIVITY: 3 * 60 * 1000, // 3 minutes for activity chart
  SENTIMENT: 5 * 60 * 1000, // 5 minutes for sentiment data
  METRICS: 2 * 60 * 1000, // 2 minutes for conversation metrics
};

// Date range for analytics
const dateRange = ref({
  startDate: "",
  endDate: "",
});

// Real data - fetched from API
interface Agent {
  id: string;
  name: string;
  enabled: boolean;
  created_at: string;
  description?: string | null;
  organization?: any;
  playbooks?: any[];
  updated_at: string;
}

interface Conversation {
  id: string;
  title?: string;
  status: string;
  agent_id?: string;
  created_at: string;
  updated_at: string;
  messages?: Array<{ content: string }>;
  organization?: any;
  metadata?: Record<string, unknown> | null;
}

interface ConversationStat {
  date: string;
  count: number;
  label: string;
  chartIndex?: number;
}

const agents = ref<Agent[]>([]);
const conversations = ref<Conversation[]>([]);
const conversationStats = ref<ConversationStat[]>([]);

// Analytics data
const sentimentData = ref<Array<{ sentiment: string; count: number; percentage: number }>>([]);
const conversationMetrics = ref({
  totalConversations: 0,
  resolvedConversations: 0,
  resolutionRate: 0,
  avgMessagesPerConversation: 0,
});

// Computed properties for dashboard data
const metrics = computed(() => {
  const activeAgents = agents.value.filter((a) => a.enabled).length;
  const totalConversations = conversations.value.length;

  // Calculate metrics based on real data
  return {
    activeAgents,
    newAgentsThisWeek: agents.value.filter((a) => {
      const createdAt = new Date(a.created_at);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return createdAt > weekAgo;
    }).length,
    totalConversations,
    conversationsGrowth: totalConversations > 0 ? 12.5 : 0, // Mock for now
    resolutionRate: 94, // Mock for now
    resolutionRateChange: 2.1, // Mock for now
    avgResponseTime: 1.8, // Mock for now
    responseTimeImprovement: 15.3, // Mock for now
  };
});

const recentActivity = ref([
  {
    id: 1,
    type: "success",
    icon: Bot,
    title: "New agent created",
    description: "Support Bot v2 was successfully created and deployed",
    timestamp: new Date(Date.now() - 1000 * 60 * 15), // 15 minutes ago
  },
  {
    id: 2,
    type: "info",
    icon: MessageSquare,
    title: "High conversation volume",
    description: "250 conversations handled in the last hour",
    timestamp: new Date(Date.now() - 1000 * 60 * 45), // 45 minutes ago
  },
  {
    id: 3,
    type: "warning",
    icon: AlertCircle,
    title: "Agent needs attention",
    description: "Customer Support Bot has a low resolution rate today",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
  },
  {
    id: 4,
    type: "success",
    icon: Zap,
    title: "New insight generated",
    description: "AI identified 3 potential playbook improvements",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4), // 4 hours ago
  },
]);

// Computed property for top agents based on conversation count
const topAgents = computed(() => {
  // Group conversations by agent and count them
  const agentConversationCounts = new Map<string, number>();

  conversations.value.forEach((conv) => {
    if (conv.agent_id) {
      const count = agentConversationCounts.get(conv.agent_id) || 0;
      agentConversationCounts.set(conv.agent_id, count + 1);
    }
  });

  // Map agents with their conversation counts
  const agentsWithStats = agents.value
    .filter((agent) => agent.enabled)
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      conversations: agentConversationCounts.get(agent.id) || 0,
      resolutionRate: 90 + Math.floor(Math.random() * 10), // Mock resolution rate for now
    }))
    .sort((a, b) => b.conversations - a.conversations)
    .slice(0, 4); // Get top 4 agents

  // If no agents, return empty array
  if (agentsWithStats.length === 0) {
    return [];
  }

  return agentsWithStats;
});

// Computed properties for sentiment visualization
const formattedSentimentData = computed(() => {
  return sentimentData.value.map((item) => ({
    label: item.sentiment.charAt(0).toUpperCase() + item.sentiment.slice(1),
    value: item.count,
  }));
});

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
      // Get the last message if available
      const lastMessage =
        conv.messages && conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null;

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
    return "Just now";
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes}m ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours}h ago`;
  } else {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days}d ago`;
  }
};

const fetchDashboardData = async (forceRefresh = false) => {
  try {
    const dateFilters = {
      startDate: dateRange.value.startDate
        ? new Date(dateRange.value.startDate).toISOString()
        : undefined,
      endDate: dateRange.value.endDate
        ? new Date(dateRange.value.endDate).toISOString()
        : undefined,
    };

    // Fetch all data in parallel using the analytics store for caching
    const [agentsData, conversationsData, analyticsData, sentimentAnalysis, metricsData] =
      await Promise.all([
        // Agents data with caching
        analyticsStore.fetchData(CACHE_KEYS.AGENTS, () => HayApi.agents.list.query(), {
          ttl: CACHE_TTL.AGENTS,
          forceRefresh,
        }),
        // Conversations data with shorter cache for recent updates
        analyticsStore.fetchData(
          CACHE_KEYS.CONVERSATIONS,
          () =>
            HayApi.conversations.list.query({
              pagination: { page: 1, limit: 10 },
            }),
          { ttl: CACHE_TTL.CONVERSATIONS, forceRefresh },
        ),
        // Activity chart data
        analyticsStore.fetchData(
          CACHE_KEYS.ACTIVITY,
          () => HayApi.analytics.conversationActivity.query(dateFilters),
          { ttl: CACHE_TTL.ACTIVITY, forceRefresh },
        ),
        // Sentiment analysis data
        analyticsStore.fetchData(
          CACHE_KEYS.SENTIMENT,
          () => HayApi.analytics.sentimentAnalysis.query(dateFilters),
          { ttl: CACHE_TTL.SENTIMENT, forceRefresh },
        ),
        // Conversation metrics
        analyticsStore.fetchData(
          CACHE_KEYS.METRICS,
          () => HayApi.analytics.conversationMetrics.query(dateFilters),
          { ttl: CACHE_TTL.METRICS, forceRefresh },
        ),
      ]);

    agents.value = (agentsData as Agent[]) || [];

    // Handle both paginated and non-paginated responses
    if (
      conversationsData &&
      typeof conversationsData === "object" &&
      "items" in conversationsData
    ) {
      conversations.value = (conversationsData as { items: Conversation[] }).items || [];
    } else {
      conversations.value = (conversationsData as Conversation[]) || [];
    }

    // Handle the analytics data from the new endpoint
    const statsData = (analyticsData as { data?: ConversationStat[] })?.data || [];

    // Process the data to add numeric indices for proper chart rendering
    conversationStats.value = Array.isArray(statsData)
      ? statsData.map((item: ConversationStat, index: number) => ({
          ...item,
          chartIndex: index, // Add numeric index for x-axis
          count: Number(item.count) || 0, // Ensure count is numeric
        }))
      : [];

    // Update sentiment data
    sentimentData.value =
      (
        sentimentAnalysis as {
          data?: Array<{ sentiment: string; count: number; percentage: number }>;
        }
      )?.data || [];

    // Update conversation metrics
    const metrics = (metricsData as { data?: Record<string, number> })?.data || {};
    conversationMetrics.value = {
      totalConversations: metrics.totalConversations || 0,
      resolvedConversations: metrics.resolvedConversations || 0,
      resolutionRate: metrics.resolutionRate || 0,
      avgMessagesPerConversation: metrics.avgMessagesPerConversation || 0,
    };
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    // Set empty arrays on error to prevent UI issues
    agents.value = [];
    conversations.value = [];
    conversationStats.value = [];
  }
};

const refreshData = async () => {
  loading.value = true;
  try {
    // Force refresh to bypass cache
    await fetchDashboardData(true);
  } catch (error) {
    console.error("Error refreshing data:", error);
  } finally {
    loading.value = false;
  }
};

const createAgent = () => {
  router.push("/agents/new");
};

const viewAllAgents = () => {
  router.push("/agents");
};

const viewAllConversations = () => {
  router.push("/conversations");
};

const viewConversation = (id: string) => {
  router.push(`/conversations/${id}`);
};

const viewInsights = () => {
  router.push("/insights");
};

const managePlaybooks = () => {
  router.push("/playbooks");
};

const scrollToTop = () => {
  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
};

// Computed property to check if any data is being loaded
const isAnyDataLoading = computed(() => {
  return Object.values(CACHE_KEYS).some((key) => analyticsStore.isWidgetLoading(key));
});

// Computed property to check if any data is being refreshed
const isAnyDataRefreshing = computed(() => {
  return Object.values(CACHE_KEYS).some((key) => analyticsStore.isWidgetRefreshing(key));
});

// Lifecycle
onMounted(async () => {
  loading.value = true;
  // Don't force refresh on mount - use cached data if available
  await fetchDashboardData(false);
  loading.value = false;
});

// Watch for date range changes
watch(dateRange, async () => {
  // Clear cache for date-sensitive data and refetch
  analyticsStore.clearData(CACHE_KEYS.ACTIVITY);
  analyticsStore.clearData(CACHE_KEYS.SENTIMENT);
  analyticsStore.clearData(CACHE_KEYS.METRICS);
  await fetchDashboardData(true);
});

// TODO: Set up WebSocket listeners for real-time updates
// TODO: Implement data refresh intervals
// TODO: Add error handling and retry logic
// TODO: Implement proper loading states
// TODO: Add accessibility improvements
// TODO: Implement keyboard navigation

// SEO
useHead({
  title: "Dashboard - Hay",
  meta: [
    {
      name: "description",
      content: "Manage your AI agents and view performance metrics",
    },
  ],
});
</script>
