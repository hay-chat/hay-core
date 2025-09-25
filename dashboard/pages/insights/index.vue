<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Insights</h1>
        <p class="text-neutral-muted">AI-generated insights to improve your chatbot performance</p>
      </div>
      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm">
          <RefreshCcw class="h-4 w-4 mr-2" />
          Refresh
        </Button>
        <Button variant="outline" size="sm">
          <Settings class="h-4 w-4 mr-2" />
          Settings
        </Button>
      </div>
    </div>

    <div class="flex items-center space-x-4 p-4 bg-background-secondary rounded-lg">
      <div class="flex items-center space-x-2">
        <Filter class="h-4 w-4 text-neutral-muted" />
        <span class="text-sm font-medium">Filters:</span>
      </div>
      <div class="flex items-center space-x-2">
        <Label for="type-filter" class="text-sm">Type:</Label>
        <select id="type-filter" v-model="selectedType" class="px-3 py-1 text-sm border rounded-md">
          <option value="">All Types</option>
          <option value="new-playbook">New Playbook</option>
          <option value="improvement">Improvement</option>
          <option value="pattern">Pattern</option>
          <option value="performance">Performance</option>
        </select>
      </div>
      <div class="flex items-center space-x-2">
        <Label for="agent-filter" class="text-sm">Agent:</Label>
        <select
          id="agent-filter"
          v-model="selectedAgent"
          class="px-3 py-1 text-sm border rounded-md"
        >
          <option value="">All Agents</option>
          <option v-for="agent in agents" :key="agent.id" :value="agent.id">
            {{ agent.name }}
          </option>
        </select>
      </div>
      <div class="flex items-center space-x-2">
        <Label for="date-filter" class="text-sm">Date:</Label>
        <select
          id="date-filter"
          v-model="selectedDateRange"
          class="px-3 py-1 text-sm border rounded-md"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>
    </div>

    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">Pending Insights</h2>
        <span class="text-sm text-neutral-muted"
          >{{ filteredPendingInsights.length }} insights</span
        >
      </div>

      <div v-if="loading" class="space-y-4">
        <div v-for="i in 3" :key="i" class="animate-pulse">
          <Card>
            <CardHeader>
              <div class="h-4 bg-gray-200 rounded w-1/4" />
              <div class="h-3 bg-gray-200 rounded w-3/4 mt-2" />
            </CardHeader>
            <CardContent>
              <div class="h-3 bg-gray-200 rounded w-full" />
              <div class="h-3 bg-gray-200 rounded w-2/3 mt-2" />
            </CardContent>
          </Card>
        </div>
      </div>

      <div v-else-if="filteredPendingInsights.length === 0" class="text-center py-12">
        <Lightbulb class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
        <h3 class="text-lg font-medium mb-2">No insights available</h3>
        <p class="text-neutral-muted">
          Check back later for AI-generated insights to improve your agents.
        </p>
      </div>

      <div v-else class="space-y-4">
        <Card
          v-for="insight in filteredPendingInsights"
          :key="insight.id"
          class="hover:shadow-md transition-shadow"
        >
          <CardHeader>
            <div class="flex items-start justify-between">
              <div class="space-y-2">
                <div class="flex items-center space-x-2">
                  <Badge :variant="getInsightTypeVariant(insight.type)">
                    {{ getInsightTypeLabel(insight.type) }}
                  </Badge>
                  <span class="text-sm text-neutral-muted">
                    {{ formatDate(insight.createdAt) }}
                  </span>
                </div>
                <h3 class="text-lg font-medium">
                  {{ insight.title }}
                </h3>
              </div>
              <Button variant="ghost" size="sm">
                <MoreHorizontal class="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p class="text-neutral-muted mb-4">
              {{ insight.description }}
            </p>

            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-4 text-sm text-neutral-muted">
                <div class="flex items-center space-x-1">
                  <MessageSquare class="h-4 w-4" />
                  <span>{{ insight.affectedConversations }} conversations</span>
                </div>
                <div class="flex items-center space-x-1">
                  <Bot class="h-4 w-4" />
                  <span>{{ insight.agentName }}</span>
                </div>
                <div class="flex items-center space-x-1">
                  <TrendingUp class="h-4 w-4" />
                  <span>{{ insight.impactScore }}% potential improvement</span>
                </div>
              </div>

              <div class="flex items-center space-x-2">
                <Button variant="outline" size="sm" @click="previewInsight(insight)">
                  <Eye class="h-4 w-4 mr-2" />
                  Preview
                </Button>
                <Button variant="outline" size="sm" @click="rejectInsight(insight.id)">
                  <X class="h-4 w-4 mr-2" />
                  Reject
                </Button>
                <Button size="sm" @click="acceptInsight(insight.id)">
                  <Check class="h-4 w-4 mr-2" />
                  Accept
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <div class="space-y-4">
      <h2 class="text-xl font-semibold">Accepted Insights</h2>

      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-medium">Recent Implementations</h3>
            <Button variant="outline" size="sm">
              <Download class="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div v-if="acceptedInsights.length === 0" class="text-center py-8">
            <CheckCircle class="h-8 w-8 text-neutral-muted mx-auto mb-2" />
            <p class="text-neutral-muted">No accepted insights yet</p>
          </div>

          <div v-else class="space-y-4">
            <div
              v-for="insight in acceptedInsights"
              :key="insight.id"
              class="flex items-center justify-between p-4 border rounded-lg"
            >
              <div class="space-y-1">
                <div class="flex items-center space-x-2">
                  <Badge variant="outline">
                    {{ getInsightTypeLabel(insight.type) }}
                  </Badge>
                  <span class="font-medium">{{ insight.title }}</span>
                </div>
                <p class="text-sm text-neutral-muted">
                  Implemented {{ formatDate(insight.implementedAt) }} • {{ insight.performance }}%
                  improvement achieved
                </p>
              </div>
              <div class="flex items-center space-x-2">
                <Button variant="ghost" size="sm">
                  <BarChart3 class="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm">
                  <ExternalLink class="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
  <div>
    <h1>Insights</h1>
    <svg
      width="178"
      height="184"
      viewBox="0 0 178 184"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M94.2814 80.1376C92.2876 40.6705 93.9285 -8.55177 111.199 1.80066C129.379 12.6985 114.875 59.6346 101.697 90.5184C134.88 69.0582 178.328 45.8669 177.998 65.9999C177.651 87.1931 129.749 98.1007 96.4142 102.131C131.591 120.138 173.4 146.169 155.799 155.95C137.271 166.245 103.875 130.215 83.7179 103.361C85.7118 142.828 84.0719 192.053 66.8009 181.7C48.6211 170.803 63.1247 123.866 76.3019 92.9823C43.1194 114.442 -0.327975 137.633 0.0020752 117.5C0.349711 96.3071 48.2491 85.3992 81.5841 81.369C46.4078 63.3622 4.60047 37.3314 22.2013 27.5507C40.7286 17.2556 74.1237 53.2838 94.2814 80.1376Z"
        fill="#BEDA58"
      />
    </svg>
    <p>Coming soon</p>
  </div>
</template>

<script setup lang="ts">
// Reactive state
const loading = ref(true);
const selectedType = ref("");
const selectedAgent = ref("");
const selectedDateRange = ref("30d");

// Mock data - TODO: Replace with actual API calls
interface Agent {
  id: string;
  name: string;
}

const agents = ref<Agent[]>([
  { id: "1", name: "Customer Support Agent" },
  { id: "2", name: "Sales Assistant" },
  { id: "3", name: "Technical Support" },
]);

interface PendingInsight {
  id: string;
  type: string;
  title: string;
  description: string;
  affectedConversations: number;
  agentName: string;
  impactScore: number;
  createdAt: Date;
  agentId: string;
}

const pendingInsights = ref<PendingInsight[]>([
  {
    id: "1",
    type: "new-playbook",
    title: 'Create "Billing Issues" Playbook',
    description:
      "Detected pattern in 47 conversations where customers ask about billing. A dedicated playbook could improve resolution time by 35%.",
    affectedConversations: 47,
    agentName: "Customer Support Agent",
    impactScore: 35,
    createdAt: new Date("2024-01-15"),
    agentId: "1",
  },
  {
    id: "2",
    type: "improvement",
    title: "Improve Product Information Responses",
    description:
      "Current product responses are too generic. Adding specific product details could increase customer satisfaction by 28%.",
    affectedConversations: 23,
    agentName: "Sales Assistant",
    impactScore: 28,
    createdAt: new Date("2024-01-14"),
    agentId: "2",
  },
  {
    id: "3",
    type: "pattern",
    title: "Technical Setup Questions Pattern",
    description:
      "Users frequently ask similar setup questions. Creating a step-by-step guide playbook could reduce escalations.",
    affectedConversations: 31,
    agentName: "Technical Support",
    impactScore: 42,
    createdAt: new Date("2024-01-13"),
    agentId: "3",
  },
]);

interface AcceptedInsight {
  id: string;
  type: string;
  title: string;
  implementedAt: Date;
  performance: number;
}

const acceptedInsights = ref<AcceptedInsight[]>([
  {
    id: "4",
    type: "improvement",
    title: "Enhanced Greeting Messages",
    implementedAt: new Date("2024-01-10"),
    performance: 22,
  },
  {
    id: "5",
    type: "new-playbook",
    title: "Password Reset Automation",
    implementedAt: new Date("2024-01-08"),
    performance: 45,
  },
]);

// Computed properties
const filteredPendingInsights = computed(() => {
  return pendingInsights.value.filter((insight) => {
    if (selectedType.value && insight.type !== selectedType.value) return false;
    if (selectedAgent.value && insight.agentId !== selectedAgent.value) return false;
    return true;
  });
});

// Methods
const getInsightTypeLabel = (type: string) => {
  const labels = {
    "new-playbook": "New Playbook",
    improvement: "Improvement",
    pattern: "Pattern",
    performance: "Performance",
  };
  return labels[type as keyof typeof labels] || type;
};

const getInsightTypeVariant = (
  type: string,
): "default" | "destructive" | "outline" | "secondary" | "success" => {
  const variants: Record<
    string,
    "default" | "destructive" | "outline" | "secondary" | "success"
  > = {
    "new-playbook": "default",
    improvement: "secondary",
    pattern: "success",
    performance: "destructive",
  };
  return variants[type as keyof typeof variants] || "default";
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const previewInsight = (insight: PendingInsight) => {
  // TODO: Open insight preview modal
  console.log("Preview insight:", insight);
};

const acceptInsight = (insightId: string) => {
  // TODO: Implement insight acceptance
  console.log("Accept insight:", insightId);

  // Mock: Move to accepted insights
  const insight = pendingInsights.value.find((i) => i.id === insightId);
  if (insight) {
    pendingInsights.value = pendingInsights.value.filter((i) => i.id !== insightId);
    // TODO: Create actual playbook or implement improvement
  }
};

const rejectInsight = (insightId: string) => {
  // TODO: Implement insight rejection
  console.log("Reject insight:", insightId);

  // Mock: Remove from pending
  pendingInsights.value = pendingInsights.value.filter((i) => i.id !== insightId);
};

// Lifecycle
onMounted(async () => {
  // TODO: Fetch insights from API
  // await fetchInsights()
  // await fetchAgents()

  // Simulate loading
  setTimeout(() => {
    loading.value = false;
  }, 1000);
});

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: 'auth',
});

// Head management
useHead({
  title: "Insights - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "AI-generated insights to improve your chatbot performance",
    },
  ],
});
</script>
