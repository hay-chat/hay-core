<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Analytics</h1>
        <p class="text-muted-foreground">
          Monitor your chatbot performance and conversation insights
        </p>
      </div>
      <div class="flex items-center space-x-2">
        <select
          v-model="selectedTimeframe"
          class="px-3 py-2 text-sm border border-input rounded-md"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="custom">Custom Range</option>
        </select>
        <Button variant="outline" size="sm" @click="exportReport">
          <Download class="h-4 w-4 mr-2" />
          Export
        </Button>
        <Button variant="outline" size="sm" @click="refreshData">
          <RefreshCcw class="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
    </div>

    <!-- KPI Cards -->
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader
          class="flex flex-row items-center justify-between space-y-0 pb-2"
        >
          <span class="text-sm font-medium">Total Conversations</span>
          <MessageSquare class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">
            {{ formatNumber(kpis.totalConversations) }}
          </div>
          <div class="flex items-center space-x-1 text-xs">
            <TrendingUp class="h-3 w-3 text-green-600" />
            <span class="text-green-600">+{{ kpis.conversationsGrowth }}%</span>
            <span class="text-muted-foreground">vs last period</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          class="flex flex-row items-center justify-between space-y-0 pb-2"
        >
          <span class="text-sm font-medium">Resolution Rate</span>
          <CheckCircle class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ kpis.resolutionRate }}%</div>
          <div class="flex items-center space-x-1 text-xs">
            <TrendingUp class="h-3 w-3 text-green-600" />
            <span class="text-green-600">+{{ kpis.resolutionGrowth }}%</span>
            <span class="text-muted-foreground">vs last period</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          class="flex flex-row items-center justify-between space-y-0 pb-2"
        >
          <span class="text-sm font-medium">Avg Response Time</span>
          <Clock class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ kpis.avgResponseTime }}s</div>
          <div class="flex items-center space-x-1 text-xs">
            <TrendingDown class="h-3 w-3 text-green-600" />
            <span class="text-green-600"
              >-{{ kpis.responseTimeImprovement }}%</span
            >
            <span class="text-muted-foreground">vs last period</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          class="flex flex-row items-center justify-between space-y-0 pb-2"
        >
          <span class="text-sm font-medium">Customer Satisfaction</span>
          <Heart class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ kpis.satisfaction }}%</div>
          <div class="flex items-center space-x-1 text-xs">
            <TrendingUp class="h-3 w-3 text-green-600" />
            <span class="text-green-600">+{{ kpis.satisfactionGrowth }}%</span>
            <span class="text-muted-foreground">vs last period</span>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Charts Section -->
    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Conversation Volume Chart -->
      <Card>
        <CardHeader>
          <CardTitle>Conversation Volume</CardTitle>
          <CardDescription
            >Messages and conversations over time</CardDescription
          >
        </CardHeader>
        <CardContent>
          <div
            class="h-80 flex items-center justify-center border-2 border-dashed border-muted rounded-lg"
          >
            <div class="text-center">
              <BarChart3 class="h-12 w-12 text-muted-foreground mx-auto mb-2" />
              <p class="text-sm text-muted-foreground">
                Chart will be rendered here
              </p>
              <p class="text-xs text-muted-foreground">
                TODO: Integrate Chart.js/vue-chartjs
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Resolution Rate Trend -->
      <Card>
        <CardHeader>
          <CardTitle>Resolution Rate Trend</CardTitle>
          <CardDescription>How well your agents resolve issues</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            class="h-80 flex items-center justify-center border-2 border-dashed border-muted rounded-lg"
          >
            <div class="text-center">
              <TrendingUp
                class="h-12 w-12 text-muted-foreground mx-auto mb-2"
              />
              <p class="text-sm text-muted-foreground">
                Line chart will be rendered here
              </p>
              <p class="text-xs text-muted-foreground">
                TODO: Integrate Chart.js/vue-chartjs
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Response Time Distribution & Top Issues -->
    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Response Time Distribution -->
      <Card>
        <CardHeader>
          <CardTitle>Response Time Distribution</CardTitle>
          <CardDescription>Breakdown of agent response times</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <div
              v-for="bucket in responseTimeBuckets"
              :key="bucket.range"
              class="space-y-2"
            >
              <div class="flex items-center justify-between text-sm">
                <span>{{ bucket.range }}</span>
                <span class="font-medium">{{ bucket.percentage }}%</span>
              </div>
              <div class="w-full bg-background-tertiary rounded-full h-2">
                <div
                  class="bg-primary h-2 rounded-full transition-all duration-300"
                  :style="{ width: `${bucket.percentage}%` }"
                ></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Top Issues/Topics -->
      <Card>
        <CardHeader>
          <CardTitle>Top Issues</CardTitle>
          <CardDescription>Most common conversation topics</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <div
              v-for="(issue, index) in topIssues"
              :key="issue.topic"
              class="flex items-center justify-between"
            >
              <div class="flex items-center space-x-3">
                <div
                  class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary"
                >
                  {{ index + 1 }}
                </div>
                <div>
                  <div class="font-medium">{{ issue.topic }}</div>
                  <div class="text-sm text-muted-foreground">
                    {{ issue.count }} conversations
                  </div>
                </div>
              </div>
              <div class="text-right">
                <div class="text-sm font-medium">{{ issue.percentage }}%</div>
                <div class="text-xs text-muted-foreground">of total</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Agent Performance Table -->
    <Card>
      <CardHeader>
        <CardTitle>Agent Performance</CardTitle>
        <CardDescription
          >Individual agent metrics and statistics</CardDescription
        >
      </CardHeader>
      <CardContent>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b">
                <th class="text-left py-3 px-4 font-medium">Agent</th>
                <th class="text-left py-3 px-4 font-medium">Conversations</th>
                <th class="text-left py-3 px-4 font-medium">Resolution Rate</th>
                <th class="text-left py-3 px-4 font-medium">
                  Avg Response Time
                </th>
                <th class="text-left py-3 px-4 font-medium">Satisfaction</th>
                <th class="text-left py-3 px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="agent in agentPerformance"
                :key="agent.id"
                class="border-b hover:bg-background-secondary"
              >
                <td class="py-3 px-4">
                  <div class="flex items-center space-x-3">
                    <div
                      class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center"
                    >
                      <Bot class="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div class="font-medium">{{ agent.name }}</div>
                      <div class="text-sm text-muted-foreground">
                        {{ agent.type }}
                      </div>
                    </div>
                  </div>
                </td>
                <td class="py-3 px-4">
                  <div class="font-medium">
                    {{ formatNumber(agent.conversations) }}
                  </div>
                  <div class="text-sm text-muted-foreground">
                    {{ agent.conversationsChange > 0 ? "+" : ""
                    }}{{ agent.conversationsChange }}% change
                  </div>
                </td>
                <td class="py-3 px-4">
                  <div class="font-medium">{{ agent.resolutionRate }}%</div>
                  <div
                    class="w-full bg-background-tertiary rounded-full h-1 mt-1"
                  >
                    <div
                      class="bg-green-500 h-1 rounded-full"
                      :style="{ width: `${agent.resolutionRate}%` }"
                    ></div>
                  </div>
                </td>
                <td class="py-3 px-4">
                  <div class="font-medium">{{ agent.avgResponseTime }}s</div>
                  <div
                    class="text-sm"
                    :class="
                      agent.responseTimeChange < 0
                        ? 'text-green-600'
                        : 'text-red-600'
                    "
                  >
                    {{ agent.responseTimeChange > 0 ? "+" : ""
                    }}{{ agent.responseTimeChange }}% change
                  </div>
                </td>
                <td class="py-3 px-4">
                  <div class="flex items-center space-x-1">
                    <Star class="h-4 w-4 text-yellow-500 fill-current" />
                    <span class="font-medium">{{ agent.satisfaction }}/5</span>
                  </div>
                </td>
                <td class="py-3 px-4">
                  <Badge
                    :variant="
                      agent.status === 'active' ? 'success' : 'secondary'
                    "
                  >
                    {{ agent.status }}
                  </Badge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>

    <!-- Channel Performance -->
    <Card>
      <CardHeader>
        <CardTitle>Channel Performance</CardTitle>
        <CardDescription
          >Performance metrics across different channels</CardDescription
        >
      </CardHeader>
      <CardContent>
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div
            v-for="channel in channelPerformance"
            :key="channel.name"
            class="p-4 border rounded-lg"
          >
            <div class="flex items-center space-x-3 mb-3">
              <component :is="channel.icon" class="h-5 w-5 text-primary" />
              <h3 class="font-medium">{{ channel.name }}</h3>
            </div>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-muted-foreground">Messages:</span>
                <span class="font-medium">{{
                  formatNumber(channel.messages)
                }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Resolution:</span>
                <span class="font-medium">{{ channel.resolutionRate }}%</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Response Time:</span>
                <span class="font-medium">{{ channel.avgResponseTime }}s</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Satisfaction:</span>
                <div class="flex items-center space-x-1">
                  <Star class="h-3 w-3 text-yellow-500 fill-current" />
                  <span class="font-medium">{{ channel.satisfaction }}/5</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import {
  Download,
  RefreshCcw,
  MessageSquare,
  CheckCircle,
  Clock,
  Heart,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Bot,
  Star,
  Globe,
  MessageCircle,
  Mail,
} from "lucide-vue-next";

// TODO: Import actual Badge component when available
const Badge = ({ variant = "default", ...props }) =>
  h("span", {
    class: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      variant === "outline"
        ? "border border-gray-300 text-gray-700"
        : variant === "secondary"
        ? "bg-blue-100 text-blue-800"
        : variant === "destructive"
        ? "bg-red-100 text-red-800"
        : variant === "success"
        ? "bg-green-100 text-green-800"
        : "bg-gray-100 text-gray-800"
    }`,
    ...props,
  });

// Reactive state
const selectedTimeframe = ref("30d");

// Mock data - TODO: Replace with actual API calls
const kpis = ref({
  totalConversations: 12847,
  conversationsGrowth: 23.5,
  resolutionRate: 87.3,
  resolutionGrowth: 4.2,
  avgResponseTime: 4.2,
  responseTimeImprovement: 12.1,
  satisfaction: 4.6,
  satisfactionGrowth: 3.8,
});

const responseTimeBuckets = ref([
  { range: "0-5 seconds", percentage: 45 },
  { range: "5-15 seconds", percentage: 32 },
  { range: "15-30 seconds", percentage: 15 },
  { range: "30-60 seconds", percentage: 6 },
  { range: "60+ seconds", percentage: 2 },
]);

const topIssues = ref([
  { topic: "Billing Questions", count: 1247, percentage: 28.5 },
  { topic: "Technical Support", count: 892, percentage: 20.4 },
  { topic: "Account Setup", count: 734, percentage: 16.8 },
  { topic: "Product Information", count: 567, percentage: 13.0 },
  { topic: "Refunds & Returns", count: 445, percentage: 10.2 },
  { topic: "Password Reset", count: 334, percentage: 7.6 },
  { topic: "Feature Requests", count: 156, percentage: 3.5 },
]);

const agentPerformance = ref([
  {
    id: "1",
    name: "Customer Support Agent",
    type: "AI Assistant",
    conversations: 4523,
    conversationsChange: 15.2,
    resolutionRate: 91.5,
    avgResponseTime: 3.8,
    responseTimeChange: -8.3,
    satisfaction: 4.7,
    status: "active",
  },
  {
    id: "2",
    name: "Sales Assistant",
    type: "AI Assistant",
    conversations: 3201,
    conversationsChange: 22.1,
    resolutionRate: 85.2,
    avgResponseTime: 4.1,
    responseTimeChange: -5.2,
    satisfaction: 4.5,
    status: "active",
  },
  {
    id: "3",
    name: "Technical Support",
    type: "AI Assistant",
    conversations: 2789,
    conversationsChange: 8.7,
    resolutionRate: 82.7,
    avgResponseTime: 5.2,
    responseTimeChange: -12.4,
    satisfaction: 4.4,
    status: "active",
  },
  {
    id: "4",
    name: "Onboarding Helper",
    type: "AI Assistant",
    conversations: 1934,
    conversationsChange: 34.5,
    resolutionRate: 94.3,
    avgResponseTime: 2.9,
    responseTimeChange: -3.1,
    satisfaction: 4.8,
    status: "active",
  },
]);

const channelPerformance = ref([
  {
    name: "Web Chat",
    icon: Globe,
    messages: 8945,
    resolutionRate: 89.2,
    avgResponseTime: 3.8,
    satisfaction: 4.6,
  },
  {
    name: "Email",
    icon: Mail,
    messages: 2341,
    resolutionRate: 92.7,
    avgResponseTime: 1847,
    satisfaction: 4.5,
  },
  {
    name: "Slack",
    icon: MessageSquare,
    messages: 1456,
    resolutionRate: 85.4,
    avgResponseTime: 5.2,
    satisfaction: 4.7,
  },
  {
    name: "WhatsApp",
    icon: MessageCircle,
    messages: 567,
    resolutionRate: 78.3,
    avgResponseTime: 8.1,
    satisfaction: 4.3,
  },
]);

// Methods
const formatNumber = (num: number) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toString();
};

const exportReport = () => {
  // TODO: Implement report export
  console.log("Export report for timeframe:", selectedTimeframe.value);
};

const refreshData = () => {
  // TODO: Refresh analytics data
  console.log("Refresh analytics data");
};

// Lifecycle
onMounted(() => {
  // TODO: Fetch analytics data from API
  // await fetchAnalyticsData(selectedTimeframe.value)
});

// Watch timeframe changes
watch(selectedTimeframe, (newTimeframe) => {
  // TODO: Fetch new data when timeframe changes
  console.log("Timeframe changed to:", newTimeframe);
});

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: 'auth',
});

// Head management
useHead({
  title: "Analytics - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Monitor your chatbot performance and conversation insights",
    },
  ],
});
</script>
