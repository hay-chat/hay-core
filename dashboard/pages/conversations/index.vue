<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Conversations</h1>
        <p class="text-muted-foreground">
          Monitor and manage all customer conversations
        </p>
      </div>
      <div class="flex items-center space-x-2">
        <Button
          size="sm"
          @click="openPlayground"
        >
          <Plus class="h-4 w-4 mr-2" />
          Conversation Playground
        </Button>
        <Button variant="outline" size="sm">
          <Download class="h-4 w-4 mr-2" />
          Export
        </Button>
        <Button variant="outline" size="sm" @click="refreshConversations">
          <RefreshCcw class="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid gap-4 md:grid-cols-4">
      <MetricCard
        title="Total Conversations"
        :icon="MessageSquare"
        :metric="stats.total"
        :subtitle="`+${stats.todayIncrease} today`"
      />

      <MetricCard
        title="Active Now"
        :icon="Activity"
        :metric="stats.active"
        subtitle="Real-time conversations"
      />

      <MetricCard
        title="Avg Response Time"
        :icon="Clock"
        :metric="`${stats.avgResponseTime}s`"
        :format-metric="false"
        subtitle="-12% from yesterday"
        subtitle-color="green"
      />

      <MetricCard
        title="Satisfaction Rate"
        :icon="Heart"
        :metric="`${stats.satisfactionRate}%`"
        :format-metric="false"
        subtitle="+3.2% this week"
        subtitle-color="green"
      />
    </div>

    <!-- Filters and Search -->
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <div class="relative">
          <Search
            class="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
          />
          <Input
            v-model="searchQuery"
            placeholder="Search conversations..."
            class="pl-8 w-[300px]"
          />
        </div>

        <select
          v-model="selectedStatus"
          class="px-3 py-2 text-sm border border-input rounded-md"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="resolved">Resolved</option>
          <option value="escalated">Escalated</option>
          <option value="closed">Closed</option>
        </select>

        <select
          v-model="selectedAgent"
          class="px-3 py-2 text-sm border border-input rounded-md"
        >
          <option value="">All Agents</option>
          <option v-for="agent in agents" :key="agent.id" :value="agent.id">
            {{ agent.name }}
          </option>
        </select>

        <select
          v-model="selectedTimeframe"
          class="px-3 py-2 text-sm border border-input rounded-md"
        >
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="all">All Time</option>
        </select>
      </div>

      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm" @click="toggleBulkMode">
          <CheckSquare class="h-4 w-4 mr-2" />
          {{ bulkMode ? "Exit" : "Select" }}
        </Button>
        <Button
          v-if="selectedConversations.length > 0"
          variant="outline"
          size="sm"
        >
          <Archive class="h-4 w-4 mr-2" />
          Archive ({{ selectedConversations.length }})
        </Button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="space-y-4">
      <div v-for="i in 5" :key="i" class="animate-pulse">
        <Card>
          <CardContent class="p-4">
            <div class="flex items-center space-x-4">
              <div class="w-10 h-10 bg-gray-200 rounded-full"></div>
              <div class="flex-1">
                <div class="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
                <div class="h-3 bg-gray-200 rounded w-2/3"></div>
              </div>
              <div class="h-3 bg-gray-200 rounded w-16"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="text-center py-12">
      <AlertTriangle class="h-12 w-12 text-red-500 mx-auto mb-4" />
      <h3 class="text-lg font-medium mb-2">Error Loading Conversations</h3>
      <p class="text-muted-foreground mb-4">{{ error }}</p>
      <Button @click="fetchConversations" variant="outline">
        <RefreshCcw class="h-4 w-4 mr-2" />
        Try Again
      </Button>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="filteredConversations.length === 0"
      class="text-center py-12"
    >
      <MessageSquare class="h-12 w-12 text-muted-foreground mx-auto mb-4" />
      <h3 class="text-lg font-medium mb-2">
        {{ searchQuery ? "No conversations found" : "No conversations yet" }}
      </h3>
      <p class="text-muted-foreground mb-4">
        {{
          searchQuery
            ? "Try adjusting your search terms or filters."
            : "Click 'New Conversation' to start your first conversation."
        }}
      </p>
      <Button
        v-if="!searchQuery"
        @click="openPlayground"
      >
        <Plus class="h-4 w-4 mr-2" />
        Start Playground
      </Button>
    </div>

    <!-- Conversations Table -->
    <Card v-else>
      <CardContent class="!p-0">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="border-b">
              <tr>
                <th v-if="bulkMode" class="text-left py-3 px-4 w-12">
                  <Checkbox
                    :checked="
                      selectedConversations.length > 0 &&
                      selectedConversations.length ===
                        paginatedConversations.length
                    "
                    @update:checked="toggleSelectAll"
                  />
                </th>
                <th class="text-left py-3 px-4 font-medium">Customer</th>
                <th class="text-left py-3 px-4 font-medium">Agent</th>
                <th class="text-left py-3 px-4 font-medium">Status</th>
                <th class="text-left py-3 px-4 font-medium">Last Message</th>
                <th class="text-left py-3 px-4 font-medium">Duration</th>
                <th class="text-left py-3 px-4 font-medium">Satisfaction</th>
                <th class="text-left py-3 px-4 font-medium">Updated</th>
                <th class="text-left py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="conversation in paginatedConversations"
                :key="conversation.id"
                class="border-b hover:bg-muted/50 cursor-pointer"
                @click="!bulkMode && viewConversation(conversation.id)"
              >
                <td v-if="bulkMode" class="py-3 px-4" @click.stop>
                  <Checkbox
                    :checked="selectedConversations.includes(conversation.id)"
                    @update:checked="
                      toggleConversationSelection(conversation.id)
                    "
                  />
                </td>
                <td class="py-3 px-4">
                  <div class="flex items-center space-x-3">
                    <div
                      class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center"
                    >
                      <User class="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div class="font-medium">
                        {{ conversation.title || "Untitled Conversation" }}
                      </div>
                      <div class="text-xs text-muted-foreground">
                        {{ conversation.id.slice(0, 8) }}...
                      </div>
                    </div>
                  </div>
                </td>
                <td class="py-3 px-4">
                  <div class="flex items-center space-x-2">
                    <div
                      class="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center"
                    >
                      <Bot class="h-3 w-3 text-blue-600" />
                    </div>
                    <span class="text-sm">{{
                      conversation.agent?.name || "AI Assistant"
                    }}</span>
                  </div>
                </td>
                <td class="py-3 px-4">
                  <Badge :variant="getStatusVariant(conversation?.status)">
                    <component
                      :is="getStatusIcon(conversation?.status)"
                      class="h-3 w-3 mr-1"
                    />
                    {{ formatStatus(conversation?.status) }}
                  </Badge>
                </td>
                <td class="py-3 px-4 max-w-xs">
                  <div class="truncate text-sm">
                    {{
                      conversation.metadata?.lastMessage || "No messages yet"
                    }}
                  </div>
                  <div class="text-xs text-muted-foreground">
                    {{ conversation.metadata?.lastSender || "-" }}
                  </div>
                </td>
                <td class="py-3 px-4 text-sm">
                  {{ formatDuration(conversation.created_at, conversation.ended_at || new Date()) }}
                </td>
                <td class="py-3 px-4">
                  <div
                    v-if="conversation.metadata?.satisfaction"
                    class="flex items-center space-x-1"
                  >
                    <Star class="h-4 w-4 text-yellow-500 fill-current" />
                    <span class="text-sm"
                      >{{ conversation.metadata.satisfaction }}/5</span
                    >
                  </div>
                  <span v-else class="text-xs text-muted-foreground"
                    >Not rated</span
                  >
                </td>
                <td class="py-3 px-4 text-sm text-muted-foreground">
                  {{ formatRelativeTime(conversation.updated_at) }}
                </td>
                <td class="py-3 px-4" @click.stop>
                  <div class="flex items-center space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      @click="viewConversation(conversation.id)"
                    >
                      <Eye class="h-4 w-4" />
                    </Button>
                    <Button
                      v-if="
                        conversation.status === 'open' ||
                        conversation.status === 'pending-human'
                      "
                      variant="ghost"
                      size="sm"
                      @click="takeOverConversation(conversation.id)"
                    >
                      <UserCheck class="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      @click="showMoreActions(conversation.id)"
                    >
                      <MoreHorizontal class="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>

    <!-- Pagination -->
    <DataPagination
      v-if="!loading && totalConversations > 0"
      :current-page="currentPage"
      :total-pages="totalPages"
      :items-per-page="pageSize"
      :total-items="totalConversations"
      @page-change="handlePageChange"
      @items-per-page-change="handleItemsPerPageChange"
    />
  </div>
</template>

<script setup lang="ts">
import {
  MessageSquare,
  Activity,
  Clock,
  Heart,
  Search,
  Download,
  RefreshCcw,
  CheckSquare,
  Archive,
  User,
  Bot,
  Star,
  Eye,
  UserCheck,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Circle,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Plus,
} from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { useRouter } from "vue-router";
import { useAppStore } from "@/stores/app";
import { formatRelativeTime, formatDuration } from "~/utils/date";
import Badge from "@/components/ui/Badge.vue";
import DataPagination from "@/components/DataPagination.vue";
import MetricCard from "@/components/MetricCard.vue";

// Router
const router = useRouter();

// Stores
const appStore = useAppStore();

// Reactive state
const loading = ref(true);
const error = ref<string | null>(null);
const realTimeEnabled = ref(true);
const searchQuery = ref("");
const selectedStatus = ref("");
const selectedAgent = ref("");
const selectedTimeframe = ref("week");
const bulkMode = ref(false);
const selectedConversations = ref<string[]>([]);
const currentPage = ref(1);
const pageSize = ref(10);

// API data
const conversations = ref<any[]>([]);
const totalConversations = ref(0);

// Computed total pages
const totalPages = computed(() =>
  Math.ceil(totalConversations.value / pageSize.value)
);

// Computed stats based on real conversations
const stats = computed(() => {
  const total = totalConversations.value;
  const active = conversations.value.filter(
    (c) => c.status === "open" || c.status === "processing"
  ).length;
  const resolved = conversations.value.filter(
    (c) => c.status === "resolved"
  ).length;
  const today = conversations.value.filter((c) => {
    const created = new Date(c.created_at);
    const now = new Date();
    return created.toDateString() === now.toDateString();
  }).length;

  // Calculate average response time (mock for now)
  const avgResponseTime = 4.2;

  // Calculate satisfaction rate (mock for now)
  const satisfactionRate =
    resolved > 0 ? Math.round((resolved / total) * 100) : 0;

  return {
    total,
    active,
    avgResponseTime,
    satisfactionRate,
    todayIncrease: today,
  };
});

// Mock agents for now - TODO: fetch from API
const agents = ref([
  { id: "1", name: "Customer Support Agent" },
  { id: "2", name: "Sales Assistant" },
  { id: "3", name: "Technical Support" },
]);

// For now, we'll use the conversations directly from API (already paginated)
// In the future, we should pass filters to the API
const filteredConversations = computed(() => {
  return conversations.value.filter((conversation) => {
    const matchesSearch =
      !searchQuery.value ||
      conversation.title
        ?.toLowerCase()
        .includes(searchQuery.value.toLowerCase()) ||
      conversation.id.toLowerCase().includes(searchQuery.value.toLowerCase());

    const matchesStatus =
      !selectedStatus.value || conversation.status === selectedStatus.value;

    const matchesAgent =
      !selectedAgent.value || conversation.agent_id === selectedAgent.value;

    // TODO: Implement timeframe filtering
    const matchesTimeframe = true;

    return matchesSearch && matchesStatus && matchesAgent && matchesTimeframe;
  });
});

// Use filtered conversations directly since API already handles pagination
const paginatedConversations = computed(() => {
  return filteredConversations.value;
});

// Methods
const getStatusVariant = (
  status: string
): "default" | "secondary" | "destructive" | "outline" => {
  const variants: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    open: "default",
    "pending-human": "destructive",
    resolved: "secondary",
    active: "default",
    escalated: "destructive",
    closed: "secondary",
  };
  return variants[status] || "default";
};

const getStatusIcon = (status: string) => {
  const icons = {
    open: Circle,
    "pending-human": AlertTriangle,
    resolved: CheckCircle,
    active: Circle,
    escalated: AlertTriangle,
    closed: XCircle,
  };
  return icons[status as keyof typeof icons] || Circle;
};

const formatStatus = (status: string) => {
  const labels = {
    open: "Open",
    processing: "Processing",
    "pending-human": "Pending Human",
    resolved: "Resolved",
    closed: "Closed",
  };
  return labels[status as keyof typeof labels] || status;
};



const toggleBulkMode = () => {
  bulkMode.value = !bulkMode.value;
  if (!bulkMode.value) {
    selectedConversations.value = [];
  }
};

const toggleSelectAll = (checked: boolean) => {
  if (checked) {
    selectedConversations.value = paginatedConversations.value.map((c) => c.id);
  } else {
    selectedConversations.value = [];
  }
};

const toggleConversationSelection = (id: string) => {
  const index = selectedConversations.value.indexOf(id);
  if (index > -1) {
    selectedConversations.value.splice(index, 1);
  } else {
    selectedConversations.value.push(id);
  }
};

const viewConversation = (id: string) => {
  router.push(`/conversations/${id}`);
};

const takeOverConversation = (id: string) => {
  // TODO: Implement conversation takeover
  console.log("Take over conversation:", id);
};

const showMoreActions = (id: string) => {
  // TODO: Show more actions menu
  console.log("Show more actions for conversation:", id);
};

const openPlayground = () => {
  router.push("/conversations/playground");
};

const fetchConversations = async () => {
  try {
    loading.value = true;
    error.value = null;

    const response = await HayApi.conversations.list.query({
      pagination: { page: currentPage.value, limit: pageSize.value },
      sorting: { orderBy: "created_at", orderDirection: "desc" },
    });

    conversations.value = response.items;
    totalConversations.value = response.pagination.total;
  } catch (err) {
    console.error("Failed to fetch conversations:", err);
    error.value = "Failed to load conversations";
    conversations.value = [];
  } finally {
    loading.value = false;
  }
};

const refreshConversations = async () => {
  await Promise.all([
    fetchConversations(),
    appStore.refreshConversationsCount(),
  ]);
};

const handlePageChange = async (page: number) => {
  currentPage.value = page;
  await fetchConversations();
};

const handleItemsPerPageChange = async (itemsPerPage: number) => {
  pageSize.value = itemsPerPage;
  currentPage.value = 1; // Reset to first page when changing page size
  await fetchConversations();
};

// Lifecycle
onMounted(async () => {
  await Promise.all([
    fetchConversations(),
    appStore.refreshConversationsCount(),
  ]);
  // TODO: Fetch agents from API
  // TODO: Setup real-time updates via WebSocket
});

// eslint-disable-next-line no-undef
onUnmounted(() => {
  // TODO: Cleanup WebSocket connections
});

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: "auth",
});

// Head management
useHead({
  title: "Conversations - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Monitor and manage all customer conversations",
    },
  ],
});
</script>
