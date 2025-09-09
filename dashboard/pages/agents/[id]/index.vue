<template>
  <div v-if="agent" class="space-y-8">
    <!-- Agent Header -->
    <div class="bg-background border rounded-lg p-6">
      <div
        class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4"
      >
        <div class="flex items-start space-x-4">
          <div
            class="h-16 w-16 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center"
          >
            <Bot class="h-8 w-8 text-white" />
          </div>
          <div class="flex-1">
            <div class="flex items-center space-x-2">
              <h1 class="text-2xl font-bold text-foreground">
                {{ agent.name }}
              </h1>
              <div
                :class="[
                  'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                  agent.status === 'active'
                    ? 'bg-green-100 text-green-800'
                    : agent.status === 'inactive'
                    ? 'bg-gray-100 text-gray-800'
                    : agent.status === 'training'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-red-100 text-red-800',
                ]"
              >
                <div
                  :class="[
                    'w-2 h-2 rounded-full mr-2',
                    agent.status === 'active'
                      ? 'bg-green-600'
                      : agent.status === 'inactive'
                      ? 'bg-gray-600'
                      : agent.status === 'training'
                      ? 'bg-blue-600'
                      : 'bg-red-600',
                  ]"
                ></div>
                {{ agent.status }}
              </div>
            </div>
            <p class="mt-2 text-muted-foreground">{{ agent.description }}</p>
            <div
              class="mt-3 flex items-center space-x-4 text-sm text-muted-foreground"
            >
              <span>{{ agent.type }} agent</span>
              <span>•</span>
              <span>Created {{ formatDate(agent.createdAt) }}</span>
              <span>•</span>
              <span>Last active {{ formatTimeAgo(agent.lastActivity) }}</span>
            </div>
          </div>
        </div>
        <div class="flex space-x-3">
          <Button
            variant="outline"
            :disabled="statusLoading"
            @click="toggleAgentStatus"
          >
            <Power class="mr-2 h-4 w-4" />
            {{ agent.status === "active" ? "Disable" : "Enable" }}
          </Button>
          <Button variant="outline" @click="editAgent">
            <Settings class="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button @click="testAgent">
            <MessageSquare class="mr-2 h-4 w-4" />
            Test Agent
          </Button>
        </div>
      </div>
    </div>

    <!-- Tab Navigation -->
    <div class="border-b">
      <nav class="-mb-px flex space-x-8">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="[
            'py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap',
            activeTab === tab.id
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground',
          ]"
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" class="mr-2 h-4 w-4 inline" />
          {{ tab.name }}
        </button>
      </nav>
    </div>

    <!-- Tab Content -->
    <div class="space-y-6">
      <!-- Overview Tab -->
      <div v-if="activeTab === 'overview'" class="space-y-6">
        <!-- Key Metrics -->
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Conversations"
            :icon="MessageSquare"
            :metric="agent.conversationCount"
            subtitle="+12%"
            subtitle-suffix="from last month"
            subtitle-color="green"
          />

          <MetricCard
            title="Resolution Rate"
            :icon="CheckCircle"
            :metric="`${agent.resolutionRate}%`"
            subtitle="+2%"
            subtitle-suffix="improvement"
            subtitle-color="green"
            :format-metric="false"
          />

          <MetricCard
            title="Avg Response Time"
            :icon="Clock"
            :metric="`${agent.avgResponseTime}s`"
            subtitle="-15%"
            subtitle-suffix="faster"
            subtitle-color="green"
            :format-metric="false"
          />

          <MetricCard
            title="Satisfaction Score"
            :icon="Star"
            :metric="`${agent.satisfactionScore}/5`"
            subtitle="+0.2"
            subtitle-suffix="from last month"
            subtitle-color="green"
            :format-metric="false"
          />
        </div>

        <!-- Charts and Recent Activity -->
        <div class="grid gap-6 lg:grid-cols-7">
          <!-- Performance Chart -->
          <Card class="lg:col-span-4">
            <CardHeader>
              <CardTitle>Performance Trends</CardTitle>
              <CardDescription
                >Resolution rate and response time over the last 30
                days</CardDescription
              >
            </CardHeader>
            <CardContent>
              <div
                class="h-80 flex items-center justify-center bg-background-secondary rounded-lg"
              >
                <div class="text-center text-muted-foreground">
                  <BarChart3 class="h-12 w-12 mx-auto mb-2" />
                  <p>Performance chart will be rendered here</p>
                  <p class="text-sm">Using Chart.js or vue-chartjs</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- Recent Conversations -->
          <Card class="lg:col-span-3">
            <CardHeader>
              <CardTitle>Recent Conversations</CardTitle>
              <CardDescription
                >Latest interactions handled by this agent</CardDescription
              >
            </CardHeader>
            <CardContent>
              <div class="space-y-4">
                <div
                  v-for="conversation in recentConversations"
                  :key="conversation.id"
                  class="flex items-start space-x-3 p-3 border rounded-lg hover:bg-background-secondary transition-colors cursor-pointer"
                  @click="viewConversation(conversation.id)"
                >
                  <div
                    class="h-8 w-8 rounded-full bg-background-tertiary flex items-center justify-center"
                  >
                    <User class="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-foreground truncate">
                      {{ conversation.customerName }}
                    </p>
                    <p class="text-xs text-muted-foreground truncate">
                      {{ conversation.lastMessage }}
                    </p>
                    <div class="flex items-center space-x-2 mt-1">
                      <div
                        :class="[
                          'inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium',
                          conversation.status === 'resolved'
                            ? 'bg-green-100 text-green-800'
                            : conversation.status === 'active'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-red-100 text-red-800',
                        ]"
                      >
                        {{ conversation.status }}
                      </div>
                      <span class="text-xs text-muted-foreground">{{
                        formatTimeAgo(conversation.updatedAt)
                      }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <!-- Playbooks Tab -->
      <div v-if="activeTab === 'playbooks'" class="space-y-6">
        <div class="flex justify-between items-center">
          <div>
            <h3 class="text-lg font-medium text-foreground">Agent Playbooks</h3>
            <p class="text-sm text-muted-foreground">
              Automated workflows and response patterns
            </p>
          </div>
          <Button @click="createPlaybook">
            <Plus class="mr-2 h-4 w-4" />
            Create Playbook
          </Button>
        </div>

        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card
            v-for="playbook in playbooks"
            :key="playbook.id"
            class="hover:shadow-md transition-shadow"
          >
            <CardHeader>
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <CardTitle class="text-lg">{{ playbook.name }}</CardTitle>
                  <CardDescription class="mt-1">{{
                    playbook.description
                  }}</CardDescription>
                </div>
                <div
                  :class="[
                    'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                    playbook.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800',
                  ]"
                >
                  {{ playbook.status }}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div class="space-y-3">
                <div class="text-sm">
                  <p class="text-muted-foreground">Trigger:</p>
                  <p class="font-medium">{{ playbook.trigger }}</p>
                </div>
                <div class="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p class="text-muted-foreground">Usage</p>
                    <p class="font-medium">{{ playbook.usageCount }} times</p>
                  </div>
                  <div>
                    <p class="text-muted-foreground">Success Rate</p>
                    <p class="font-medium">{{ playbook.successRate }}%</p>
                  </div>
                </div>
                <div class="flex space-x-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    class="flex-1"
                    @click="editPlaybook(playbook.id)"
                  >
                    <Settings class="mr-1 h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    class="flex-1"
                    @click="testPlaybook(playbook.id)"
                  >
                    <Play class="mr-1 h-3 w-3" />
                    Test
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <!-- Conversations Tab -->
      <div v-if="activeTab === 'conversations'" class="space-y-6">
        <div class="flex justify-between items-center">
          <div>
            <h3 class="text-lg font-medium text-foreground">
              All Conversations
            </h3>
            <p class="text-sm text-muted-foreground">
              Complete conversation history for this agent
            </p>
          </div>
          <div class="flex space-x-2">
            <Button variant="outline" @click="exportConversations">
              <Download class="mr-2 h-4 w-4" />
              Export
            </Button>
            <select
              v-model="conversationFilter"
              class="px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="resolved">Resolved</option>
              <option value="escalated">Escalated</option>
            </select>
          </div>
        </div>

        <Card>
          <CardContent class="p-0">
            <div class="divide-y">
              <div
                v-for="conversation in filteredConversations"
                :key="conversation.id"
                class="p-4 hover:bg-background-secondary transition-colors cursor-pointer"
                @click="viewConversation(conversation.id)"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-3">
                    <div
                      class="h-10 w-10 rounded-full bg-background-tertiary flex items-center justify-center"
                    >
                      <User class="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p class="font-medium text-foreground">
                        {{ conversation.customerName }}
                      </p>
                      <p class="text-sm text-muted-foreground">
                        {{ conversation.lastMessage }}
                      </p>
                    </div>
                  </div>
                  <div class="text-right">
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
                    <p class="text-xs text-muted-foreground mt-1">
                      {{ formatTimeAgo(conversation.updatedAt) }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Analytics Tab -->
      <div v-if="activeTab === 'analytics'" class="space-y-6">
        <div>
          <h3 class="text-lg font-medium text-foreground">
            Performance Analytics
          </h3>
          <p class="text-sm text-muted-foreground">
            Detailed insights into agent performance and trends
          </p>
        </div>

        <!-- Time Period Selector -->
        <div class="flex space-x-2">
          <select
            v-model="analyticsTimeframe"
            class="px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 3 months</option>
          </select>
        </div>

        <!-- Analytics Charts -->
        <div class="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Response Time Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                class="h-64 flex items-center justify-center bg-background-secondary rounded-lg"
              >
                <div class="text-center text-muted-foreground">
                  <BarChart3 class="h-8 w-8 mx-auto mb-2" />
                  <p class="text-sm">Response time chart</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resolution Rate by Day</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                class="h-64 flex items-center justify-center bg-background-secondary rounded-lg"
              >
                <div class="text-center text-muted-foreground">
                  <BarChart3 class="h-8 w-8 mx-auto mb-2" />
                  <p class="text-sm">Resolution rate chart</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Conversation Volume</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                class="h-64 flex items-center justify-center bg-background-secondary rounded-lg"
              >
                <div class="text-center text-muted-foreground">
                  <BarChart3 class="h-8 w-8 mx-auto mb-2" />
                  <p class="text-sm">Volume chart</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Customer Satisfaction</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                class="h-64 flex items-center justify-center bg-background-secondary rounded-lg"
              >
                <div class="text-center text-muted-foreground">
                  <Star class="h-8 w-8 mx-auto mb-2" />
                  <p class="text-sm">Satisfaction chart</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <!-- Settings Tab -->
      <div v-if="activeTab === 'settings'" class="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Agent Configuration</CardTitle>
            <CardDescription>Basic agent settings and behavior</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div>
              <Label htmlFor="agentName">Agent Name</Label>
              <Input id="agentName" v-model="agentSettings.name" />
            </div>
            <div>
              <Label htmlFor="agentDescription">Description</Label>
              <textarea
                id="agentDescription"
                v-model="agentSettings.description"
                rows="3"
                class="w-full px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              ></textarea>
            </div>
            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="agentType">Agent Type</Label>
                <select
                  id="agentType"
                  v-model="agentSettings.type"
                  class="w-full px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="customer-support">Customer Support</option>
                  <option value="sales">Sales Assistant</option>
                  <option value="technical">Technical Support</option>
                  <option value="general">General Assistant</option>
                </select>
              </div>
              <div>
                <Label htmlFor="language">Language</Label>
                <select
                  id="language"
                  v-model="agentSettings.language"
                  class="w-full px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                </select>
              </div>
            </div>
            <div class="flex justify-end">
              <Button @click="saveAgentSettings">Save Changes</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Advanced Settings</CardTitle>
            <CardDescription>Advanced configuration options</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="font-medium">Auto-escalation</p>
                <p class="text-sm text-muted-foreground">
                  Automatically escalate complex queries
                </p>
              </div>
              <Checkbox v-model:checked="agentSettings.autoEscalation" />
            </div>
            <div class="flex items-center justify-between">
              <div>
                <p class="font-medium">Learning Mode</p>
                <p class="text-sm text-muted-foreground">
                  Continue learning from conversations
                </p>
              </div>
              <Checkbox v-model:checked="agentSettings.learningMode" />
            </div>
            <div class="flex items-center justify-between">
              <div>
                <p class="font-medium">Real-time Analytics</p>
                <p class="text-sm text-muted-foreground">
                  Enable real-time performance tracking
                </p>
              </div>
              <Checkbox v-model:checked="agentSettings.realTimeAnalytics" />
            </div>
          </CardContent>
        </Card>

        <!-- Danger Zone -->
        <Card>
          <CardHeader>
            <CardTitle class="text-red-600">Danger Zone</CardTitle>
            <CardDescription
              >Irreversible actions for this agent</CardDescription
            >
          </CardHeader>
          <CardContent>
            <div class="flex items-center justify-between">
              <div>
                <p class="font-medium">Delete Agent</p>
                <p class="text-sm text-muted-foreground">
                  Permanently delete this agent and all its data
                </p>
              </div>
              <Button variant="destructive" @click="deleteAgent">
                Delete Agent
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>

  <!-- Loading State -->
  <div v-else-if="loading" class="space-y-8">
    <div class="bg-background border rounded-lg p-6">
      <div class="flex items-start space-x-4">
        <div
          class="h-16 w-16 bg-background-tertiary rounded-lg animate-pulse"
        ></div>
        <div class="flex-1 space-y-2">
          <div
            class="h-6 bg-background-tertiary rounded w-1/3 animate-pulse"
          ></div>
          <div
            class="h-4 bg-background-tertiary rounded w-2/3 animate-pulse"
          ></div>
          <div
            class="h-3 bg-background-tertiary rounded w-1/2 animate-pulse"
          ></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Error State -->
  <div v-else class="text-center py-12">
    <AlertCircle class="mx-auto h-12 w-12 text-red-500" />
    <h3 class="mt-4 text-lg font-medium text-foreground">Agent not found</h3>
    <p class="mt-2 text-sm text-muted-foreground">
      The agent you're looking for doesn't exist or you don't have permission to
      view it.
    </p>
    <div class="mt-6">
      <Button @click="router.push('/agents')"> Back to Agents </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Bot,
  Settings,
  Power,
  MessageSquare,
  BarChart3,
  BookOpen,
  CheckCircle,
  Clock,
  Star,
  User,
  Plus,
  Play,
  Download,
  AlertCircle,
} from "lucide-vue-next";

// Type definitions
interface Agent {
  id: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  type: string;
  conversationCount: number;
  resolutionRate: number;
  avgResponseTime: number;
  satisfactionScore: number;
  lastActivity: Date;
  createdAt: Date;
}

interface Playbook {
  id: string;
  name: string;
  description: string;
  trigger: string;
  status: "active" | "inactive";
  usageCount?: number;
  successRate?: number;
}

interface Conversation {
  id: string;
  customerName: string;
  lastMessage: string;
  status: string;
  updatedAt: Date;
  satisfaction?: number;
}

// TODO: Import agent store/composable
// TODO: Import router params

definePageMeta({
  // TODO: Add authentication middleware
  // // middleware: 'auth'
});

// Get agent ID from route
const route = useRoute();
const router = useRouter();
const agentId = route.params["id"] as string;

// State
const loading = ref(true);
const statusLoading = ref(false);
const activeTab = ref("overview");
const conversationFilter = ref("");
const analyticsTimeframe = ref("30d");

// Agent form
const agentSettings = reactive({
  name: "",
  description: "",
  type: "",
  language: "en",
  autoEscalation: false,
  learningMode: true,
  realTimeAnalytics: true,
});

// Tab configuration
const tabs = [
  { id: "overview", name: "Overview", icon: BarChart3 },
  { id: "playbooks", name: "Playbooks", icon: BookOpen },
  { id: "conversations", name: "Conversations", icon: MessageSquare },
  { id: "analytics", name: "Analytics", icon: BarChart3 },
  { id: "settings", name: "Settings", icon: Settings },
];

// Mock data - TODO: Replace with real API calls
const agent = ref<Agent | null>(null);
const playbooks = ref<Playbook[]>([
  {
    id: "1",
    name: "Welcome Message",
    description: "Greets new users and offers assistance",
    trigger: "User starts conversation",
    status: "active",
    usageCount: 245,
    successRate: 94,
  },
  {
    id: "2",
    name: "Password Reset",
    description: "Guides users through password reset process",
    trigger: "Keywords: password, reset, forgot",
    status: "active",
    usageCount: 89,
    successRate: 87,
  },
  {
    id: "3",
    name: "Billing Inquiry",
    description: "Handles billing questions and issues",
    trigger: "Keywords: billing, payment, invoice",
    status: "inactive",
    usageCount: 156,
    successRate: 91,
  },
]);

const conversations = ref<Conversation[]>([
  {
    id: "1",
    customerName: "John Smith",
    lastMessage: "Thank you for the help!",
    status: "resolved",
    updatedAt: new Date(Date.now() - 1000 * 60 * 5),
  },
  {
    id: "2",
    customerName: "Sarah Johnson",
    lastMessage: "I need help with billing",
    status: "active",
    updatedAt: new Date(Date.now() - 1000 * 60 * 12),
  },
  {
    id: "3",
    customerName: "Mike Wilson",
    lastMessage: "The integration is not working",
    status: "escalated",
    updatedAt: new Date(Date.now() - 1000 * 60 * 25),
  },
]);

const recentConversations = computed(() => conversations.value.slice(0, 5));
const filteredConversations = computed(() => {
  if (!conversationFilter.value) return conversations.value;
  return conversations.value.filter(
    (c) => c.status === conversationFilter.value
  );
});

// Methods
const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
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

const loadAgent = async () => {
  loading.value = true;
  try {
    // TODO: Fetch agent data from API
    console.log("Loading agent:", agentId);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Mock agent data
    agent.value = {
      id: agentId,
      name: "Customer Support Bot",
      description:
        "Handles general customer inquiries and support tickets with high accuracy",
      status: "active",
      type: "customer-support",
      conversationCount: 1234,
      resolutionRate: 94,
      avgResponseTime: 1.2,
      satisfactionScore: 4.6,
      lastActivity: new Date(Date.now() - 1000 * 60 * 15),
      createdAt: new Date("2023-01-15"),
    };

    // Initialize form with agent data
    agentSettings.name = agent.value.name;
    agentSettings.description = agent.value.description;
    agentSettings.type = agent.value.type;
  } catch (error) {
    console.error("Error loading agent:", error);
    // TODO: Show error notification
  } finally {
    loading.value = false;
  }
};

const toggleAgentStatus = async () => {
  statusLoading.value = true;
  try {
    // TODO: Toggle agent status via API
    console.log("Toggle agent status:", agentId);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Update local state
    if (agent.value) {
      agent.value.status =
        agent.value.status === "active" ? "inactive" : "active";
    }

    // TODO: Show success notification
  } catch (error) {
    console.error("Error toggling agent status:", error);
    // TODO: Show error notification
  } finally {
    statusLoading.value = false;
  }
};

const editAgent = () => {
  // TODO: Navigate to agent edit page
  // await navigateTo(`/agents/${agentId}/edit`)
  console.log("Edit agent:", agentId);
};

const testAgent = () => {
  // TODO: Open agent test chat interface
  console.log("Test agent:", agentId);
};

const createPlaybook = () => {
  // TODO: Navigate to playbook creation
  // await navigateTo(`/agents/${agentId}/playbooks/new`)
  console.log("Create playbook for agent:", agentId);
};

const editPlaybook = (playbookId: string) => {
  // TODO: Navigate to playbook editor
  console.log("Edit playbook:", playbookId);
};

const testPlaybook = (playbookId: string) => {
  // TODO: Test playbook functionality
  console.log("Test playbook:", playbookId);
};

const viewConversation = (conversationId: string) => {
  // TODO: Navigate to conversation detail
  // await navigateTo(`/conversations/${conversationId}`)
  console.log("View conversation:", conversationId);
};

const exportConversations = () => {
  // TODO: Export conversation data
  console.log("Export conversations for agent:", agentId);
};

const saveAgentSettings = async () => {
  try {
    // TODO: Save agent settings via API
    console.log("Save agent settings:", agentSettings);

    // TODO: Update agent data
    // TODO: Show success notification
  } catch (error) {
    console.error("Error saving agent settings:", error);
    // TODO: Show error notification
  }
};

const deleteAgent = async () => {
  try {
    // TODO: Show confirmation dialog
    // TODO: Delete agent via API
    console.log("Delete agent:", agentId);

    // TODO: Navigate back to agents list
    // await navigateTo('/agents')
  } catch (error) {
    console.error("Error deleting agent:", error);
    // TODO: Show error notification
  }
};

// Lifecycle
onMounted(async () => {
  await loadAgent();
});

// TODO: Add real-time updates for agent metrics
// TODO: Implement proper error handling
// TODO: Add accessibility improvements
// TODO: Add keyboard shortcuts

// SEO
useHead({
  title: computed(() =>
    agent.value
      ? `${agent.value.name} - Hay Dashboard`
      : "Agent - Hay Dashboard"
  ),
  meta: [
    {
      name: "description",
      content: "Manage and monitor your AI agent performance",
    },
  ],
});
</script>
