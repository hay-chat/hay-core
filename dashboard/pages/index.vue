<template>
  <div class="space-y-8">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">Dashboard</h1>
        <p class="mt-1 text-sm text-neutral-muted">
          Welcome back! Here's what's happening with your AI agents.
        </p>
      </div>
      <div class="mt-4 sm:mt-0 flex space-x-3">
        <Button variant="outline" :disabled="loading" @click="refreshData">
          <RefreshCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': loading }" />
          Refresh
        </Button>
        <Button @click="createAgent">
          <Plus class="mr-2 h-4 w-4" />
          Create Agent
        </Button>
      </div>
    </div>

    <!-- Key Metrics Cards -->
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="Active Agents"
        :icon="Bot"
        :metric="metrics.activeAgents"
        :subtitle="`+${metrics.newAgentsThisWeek}`"
        subtitle-suffix="new this week"
        subtitle-color="green"
      />

      <MetricCard
        title="Total Conversations"
        :icon="MessageSquare"
        :metric="metrics.totalConversations"
        :subtitle="`+${metrics.conversationsGrowth}%`"
        subtitle-suffix="from last month"
        subtitle-color="green"
      />

      <MetricCard
        title="Resolution Rate"
        :icon="CheckCircle"
        :metric="`${metrics.resolutionRate}%`"
        :subtitle="`+${metrics.resolutionRateChange}%`"
        subtitle-suffix="improvement"
        subtitle-color="green"
        :format-metric="false"
      />

      <MetricCard
        title="Avg Response Time"
        :icon="Clock"
        :metric="`${metrics.avgResponseTime}s`"
        :subtitle="`-${metrics.responseTimeImprovement}%`"
        subtitle-suffix="faster"
        subtitle-color="green"
        :format-metric="false"
      />
    </div>

    <!-- Charts and Activity -->
    <div class="grid gap-6 lg:grid-cols-7">
      <!-- Activity Chart -->
      <Card class="lg:col-span-4">
        <CardHeader>
          <CardTitle>Conversation Activity</CardTitle>
          <CardDescription> Daily conversation volume over the last 30 days </CardDescription>
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
      <Card class="lg:col-span-3">
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
      </Card>
    </div>

    <!-- Agent Performance and Recent Conversations -->
    <div class="grid gap-6 lg:grid-cols-2">
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
          <Button variant="outline" class="h-20 flex-col space-y-2" @click="viewAnalytics">
            <BarChart3 class="h-6 w-6" />
            <span>View Analytics</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import {
  Bot,
  MessageSquare,
  CheckCircle,
  Clock,
  BarChart3,
  User,
  Plus,
  RefreshCw,
  ChevronRight,
  Lightbulb,
  BookOpen,
  AlertCircle,
  Zap,
} from "lucide-vue-next";
import { HayApi } from "@/utils/api";

// State
const loading = ref(false);
const router = useRouter();

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

const fetchDashboardData = async () => {
  try {
    // Fetch agents, conversations, and conversation stats in parallel
    const [agentsData, conversationsData, analyticsData] = await Promise.all([
      HayApi.agents.list.query(),
      HayApi.conversations.list.query({
        pagination: { page: 1, limit: 10 },
      }),
      HayApi.analytics.conversationActivity.query({}),
      // Promise.resolve({
      //   result: {
      //     data: [
            {
              date: "2025-08-10",
              count: 0,
              label: "Aug 10",
            },
            {
              date: "2025-08-11",
              count: 0,
              label: "Aug 11",
            },
            {
              date: "2025-08-12",
              count: 0,
              label: "Aug 12",
            },
            {
              date: "2025-08-13",
              count: 0,
              label: "Aug 13",
            },
            {
              date: "2025-08-14",
              count: 0,
              label: "Aug 14",
            },
            {
              date: "2025-08-15",
              count: 0,
              label: "Aug 15",
            },
            {
              date: "2025-08-16",
              count: 0,
              label: "Aug 16",
            },
            {
              date: "2025-08-17",
              count: 0,
              label: "Aug 17",
            },
            {
              date: "2025-08-18",
              count: 0,
              label: "Aug 18",
            },
            {
              date: "2025-08-19",
              count: 0,
              label: "Aug 19",
            },
            {
              date: "2025-08-20",
              count: 0,
              label: "Aug 20",
            },
            {
              date: "2025-08-21",
              count: 0,
              label: "Aug 21",
            },
            {
              date: "2025-08-22",
              count: 0,
              label: "Aug 22",
            },
            {
              date: "2025-08-23",
              count: 0,
              label: "Aug 23",
            },
            {
              date: "2025-08-24",
              count: 0,
              label: "Aug 24",
            },
            {
              date: "2025-08-25",
              count: 0,
              label: "Aug 25",
            },
            {
              date: "2025-08-26",
              count: 0,
              label: "Aug 26",
            },
            {
              date: "2025-08-27",
              count: 0,
              label: "Aug 27",
            },
            {
              date: "2025-08-28",
              count: 0,
              label: "Aug 28",
            },
            {
              date: "2025-08-29",
              count: 0,
              label: "Aug 29",
            },
            {
              date: "2025-08-30",
              count: 0,
              label: "Aug 30",
            },
            {
              date: "2025-08-31",
              count: 0,
              label: "Aug 31",
            },
            {
              date: "2025-09-01",
              count: 0,
              label: "Sep 1",
            },
            {
              date: "2025-09-02",
              count: 0,
              label: "Sep 2",
            },
            {
              date: "2025-09-03",
              count: 0,
              label: "Sep 3",
            },
            {
              date: "2025-09-04",
              count: 0,
              label: "Sep 4",
            },
            {
              date: "2025-09-05",
              count: 0,
              label: "Sep 5",
            },
            {
              date: "2025-09-06",
              count: 0,
              label: "Sep 6",
            },
            {
              date: "2025-09-07",
              count: 5,
              label: "Sep 7",
            },
            {
              date: "2025-09-08",
              count: 35,
              label: "Sep 8",
            },
            {
              date: "2025-09-09",
      //       count: 1,
      //       label: "Sep 9",
      //     },
      //   ],
      // },
      // }),
    ]);

    agents.value = (agentsData as any) || [];
    conversations.value = (conversationsData as any)?.items || (conversationsData as any) || [];

    // Handle the analytics data from the new endpoint
    const statsData = (analyticsData as any)?.data || [];

    // Process the data to add numeric indices for proper chart rendering
    conversationStats.value = Array.isArray(statsData)
      ? statsData.map((item: ConversationStat, index: number) => ({
          ...item,
          chartIndex: index, // Add numeric index for x-axis
          count: Number(item.count) || 0, // Ensure count is numeric
        }))
      : [];
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
    await fetchDashboardData();
  } catch (error) {
    console.error("Error refreshing data:", error);
  } finally {
    loading.value = false;
  }
};

const createAgent = () => {
  router.push("/agents/create");
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

const viewAnalytics = () => {
  router.push("/analytics");
};

// Lifecycle
onMounted(async () => {
  loading.value = true;
  await fetchDashboardData();
  loading.value = false;
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
