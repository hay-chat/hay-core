<template>
  <div class="space-y-8">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">Dashboard</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Welcome back! Here's what's happening with your AI agents.
        </p>
      </div>
      <div class="mt-4 sm:mt-0 flex space-x-3">
        <Button variant="outline" :disabled="loading" @click="refreshData">
          <RefreshCw
            class="mr-2 h-4 w-4"
            :class="{ 'animate-spin': loading }"
          />
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
      <Card>
        <CardHeader
          class="flex flex-row items-center justify-between space-y-0 pb-2"
        >
          <CardTitle class="text-sm font-medium">Active Agents</CardTitle>
          <Bot class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ metrics.activeAgents }}</div>
          <p class="text-xs text-muted-foreground">
            <span class="text-green-600">+{{ metrics.newAgentsThisWeek }}</span>
            new this week
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          class="flex flex-row items-center justify-between space-y-0 pb-2"
        >
          <CardTitle class="text-sm font-medium">Total Conversations</CardTitle>
          <MessageSquare class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">
            {{ formatNumber(metrics.totalConversations) }}
          </div>
          <p class="text-xs text-muted-foreground">
            <span class="text-green-600"
              >+{{ metrics.conversationsGrowth }}%</span
            >
            from last month
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          class="flex flex-row items-center justify-between space-y-0 pb-2"
        >
          <CardTitle class="text-sm font-medium">Resolution Rate</CardTitle>
          <CheckCircle class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ metrics.resolutionRate }}%</div>
          <p class="text-xs text-muted-foreground">
            <span class="text-green-600"
              >+{{ metrics.resolutionRateChange }}%</span
            >
            improvement
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          class="flex flex-row items-center justify-between space-y-0 pb-2"
        >
          <CardTitle class="text-sm font-medium">Avg Response Time</CardTitle>
          <Clock class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ metrics.avgResponseTime }}s</div>
          <p class="text-xs text-muted-foreground">
            <span class="text-green-600"
              >-{{ metrics.responseTimeImprovement }}%</span
            >
            faster
          </p>
        </CardContent>
      </Card>
    </div>

    <!-- Charts and Activity -->
    <div class="grid gap-6 lg:grid-cols-7">
      <!-- Activity Chart -->
      <Card class="lg:col-span-4">
        <CardHeader>
          <CardTitle>Conversation Activity</CardTitle>
          <CardDescription>
            Daily conversation volume over the last 30 days
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            class="h-80 flex items-center justify-center bg-muted/50 rounded-lg"
          >
            <!-- TODO: Implement Chart.js component -->
            <div class="text-center text-muted-foreground">
              <BarChart3 class="h-12 w-12 mx-auto mb-2" />
              <p>Chart component will be rendered here</p>
              <p class="text-sm">Using Chart.js or vue-chartjs</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Recent Activity -->
      <Card class="lg:col-span-3">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>
            Latest updates from your organization
          </CardDescription>
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
                <p class="text-sm text-muted-foreground">
                  {{ activity.description }}
                </p>
                <p class="text-xs text-muted-foreground mt-1">
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
              <CardDescription>
                Best agents by resolution rate this month
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" @click="viewAllAgents">
              View All
              <ChevronRight class="ml-1 h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <div
              v-for="agent in topAgents"
              :key="agent.id"
              class="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
            >
              <div class="flex items-center space-x-3">
                <div
                  class="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center"
                >
                  <Bot class="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p class="font-medium text-foreground">{{ agent.name }}</p>
                  <p class="text-sm text-muted-foreground">
                    {{ agent.conversations }} conversations
                  </p>
                </div>
              </div>
              <div class="text-right">
                <div class="text-sm font-medium text-foreground">
                  {{ agent.resolutionRate }}%
                </div>
                <div class="text-xs text-muted-foreground">resolution rate</div>
              </div>
            </div>
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
          <div class="space-y-4">
            <div
              v-for="conversation in recentConversations"
              :key="conversation.id"
              class="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
              @click="viewConversation(conversation.id)"
            >
              <div class="flex items-center space-x-3">
                <div
                  class="h-8 w-8 rounded-full bg-muted flex items-center justify-center"
                >
                  <User class="h-4 w-4 text-muted-foreground" />
                </div>
                <div class="flex-1 min-w-0">
                  <p class="font-medium text-foreground truncate">
                    {{ conversation.customerName }}
                  </p>
                  <p class="text-sm text-muted-foreground truncate">
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
                <div class="text-xs text-muted-foreground mt-1">
                  {{ formatTimeAgo(conversation.updatedAt) }}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Quick Actions -->
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription>
          Common tasks to help you manage your AI agents
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Button
            variant="outline"
            class="h-20 flex-col space-y-2"
            @click="createAgent"
          >
            <Bot class="h-6 w-6" />
            <span>Create Agent</span>
          </Button>
          <Button
            variant="outline"
            class="h-20 flex-col space-y-2"
            @click="viewInsights"
          >
            <Lightbulb class="h-6 w-6" />
            <span>View Insights</span>
          </Button>
          <Button
            variant="outline"
            class="h-20 flex-col space-y-2"
            @click="managePlaybooks"
          >
            <BookOpen class="h-6 w-6" />
            <span>Manage Playbooks</span>
          </Button>
          <Button
            variant="outline"
            class="h-20 flex-col space-y-2"
            @click="viewAnalytics"
          >
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

// State
const loading = ref(false);

// Mock data - TODO: Replace with real API calls
const metrics = ref({
  activeAgents: 12,
  newAgentsThisWeek: 3,
  totalConversations: 24567,
  conversationsGrowth: 12.5,
  resolutionRate: 94,
  resolutionRateChange: 2.1,
  avgResponseTime: 1.8,
  responseTimeImprovement: 15.3,
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

const topAgents = ref([
  {
    id: 1,
    name: "Customer Support Bot",
    conversations: 1234,
    resolutionRate: 96,
  },
  {
    id: 2,
    name: "Sales Assistant",
    conversations: 892,
    resolutionRate: 94,
  },
  {
    id: 3,
    name: "Technical Support",
    conversations: 567,
    resolutionRate: 91,
  },
  {
    id: 4,
    name: "Billing Assistant",
    conversations: 345,
    resolutionRate: 89,
  },
]);

const recentConversations = ref([
  {
    id: 1,
    customerName: "John Smith",
    lastMessage: "Thank you for the help with my account setup!",
    status: "resolved",
    updatedAt: new Date(Date.now() - 1000 * 60 * 5), // 5 minutes ago
  },
  {
    id: 2,
    customerName: "Sarah Johnson",
    lastMessage: "I need help with billing questions...",
    status: "active",
    updatedAt: new Date(Date.now() - 1000 * 60 * 12), // 12 minutes ago
  },
  {
    id: 3,
    customerName: "Mike Wilson",
    lastMessage: "The integration is not working properly",
    status: "escalated",
    updatedAt: new Date(Date.now() - 1000 * 60 * 25), // 25 minutes ago
  },
  {
    id: 4,
    customerName: "Lisa Brown",
    lastMessage: "How do I export my data?",
    status: "active",
    updatedAt: new Date(Date.now() - 1000 * 60 * 35), // 35 minutes ago
  },
]);

// Methods
const formatNumber = (num: number) => {
  return new Intl.NumberFormat().format(num);
};

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

const refreshData = async () => {
  loading.value = true;
  try {
    // TODO: Implement data refresh logic
    // TODO: Fetch latest metrics from API
    // TODO: Update dashboard state
    console.log("Refreshing dashboard data...");

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error("Error refreshing data:", error);
    // TODO: Show error notification
  } finally {
    loading.value = false;
  }
};

const createAgent = () => {
  // TODO: Navigate to agent creation page
  // await navigateTo('/agents/new')
  console.log("Navigate to agent creation");
};

const viewAllAgents = () => {
  // TODO: Navigate to agents list page
  // await navigateTo('/agents')
  console.log("Navigate to agents list");
};

const viewAllConversations = () => {
  // TODO: Navigate to conversations list page
  // await navigateTo('/conversations')
  console.log("Navigate to conversations list");
};

const viewConversation = (id: number) => {
  // TODO: Navigate to specific conversation
  // await navigateTo(`/conversations/${id}`)
  console.log("Navigate to conversation:", id);
};

const viewInsights = () => {
  // TODO: Navigate to insights page
  // await navigateTo('/insights')
  console.log("Navigate to insights");
};

const managePlaybooks = () => {
  // TODO: Navigate to playbooks page
  // await navigateTo('/playbooks')
  console.log("Navigate to playbooks");
};

const viewAnalytics = () => {
  // TODO: Navigate to analytics page
  // await navigateTo('/analytics')
  console.log("Navigate to analytics");
};

// Lifecycle
onMounted(async () => {
  // TODO: Load initial dashboard data
  // TODO: Set up WebSocket connection for real-time updates
  // TODO: Start periodic data refresh
  console.log("Dashboard mounted - loading initial data");
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
