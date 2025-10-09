<template>
  <Page title="Conversations" description="Monitor and manage all customer conversations">
    <!-- Header -->
    <template #header>
      <div class="flex items-center space-x-2">
        <Button size="sm" @click="openPlayground">
          <Plus class="h-4 w-4 mr-2" />
          Conversation Playground
        </Button>
        <Button variant="outline" size="sm" @click="refreshConversations">
          <RefreshCcw class="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
    </template>

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
        <Input
          v-model="searchQuery"
          placeholder="Search conversations..."
          :icon-start="Search"
          class="w-[300px]"
        />

        <Input
          v-model="selectedStatus"
          type="select"
          :options="statusOptions"
          placeholder="All Status"
        />

        <Input
          v-model="selectedAgent"
          type="select"
          :options="agentOptions"
          placeholder="All Agents"
        />

        <Input v-model="selectedTimeframe" type="select" :options="timeframeOptions" />
      </div>

      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm" @click="toggleBulkMode">
          <CheckSquare class="h-4 w-4 mr-2" />
          {{ bulkMode ? "Exit" : "Select" }}
        </Button>
        <Button v-if="selectedConversations.length > 0" variant="outline" size="sm">
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
              <div class="w-10 h-10 bg-gray-200 rounded-full" />
              <div class="flex-1">
                <div class="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                <div class="h-3 bg-gray-200 rounded w-2/3" />
              </div>
              <div class="h-3 bg-gray-200 rounded w-16" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="text-center py-12">
      <Error label="Error Loading Conversations" />
      <p class="text-neutral-muted mb-4">
        {{ error }}
      </p>
      <Button variant="outline" @click="fetchConversations">
        <RefreshCcw class="h-4 w-4 mr-2" />
        Try Again
      </Button>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredConversations.length === 0" class="text-center py-12">
      <img src="/bale/conversation.svg" class="h-32 w-32 mx-auto" />
      <h3 class="text-lg font-medium mb-2">
        {{ searchQuery ? "No conversations found" : "No conversations yet" }}
      </h3>
      <p class="text-neutral-muted mb-4">
        {{
          searchQuery
            ? "Try adjusting your search terms or filters."
            : "Click 'New Conversation' to start your first conversation."
        }}
      </p>
      <Button v-if="!searchQuery" @click="openPlayground">
        <Plus class="h-4 w-4 mr-2" />
        Start Playground
      </Button>
    </div>

    <!-- Conversations Table -->
    <Card v-else>
      <CardContent class="!p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead v-if="bulkMode" class="w-12">
                <Checkbox
                  :checked="
                    selectedConversations.length > 0 &&
                    selectedConversations.length === paginatedConversations.length
                  "
                  @update:checked="toggleSelectAll"
                />
              </TableHead>
              <TableHead>Conversation</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Satisfaction</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="conversation in paginatedConversations"
              :key="conversation.id"
              class="cursor-pointer"
              @click="!bulkMode && viewConversation(conversation.id)"
            >
              <TableCell v-if="bulkMode" @click.stop>
                <Checkbox
                  :checked="selectedConversations.includes(conversation.id)"
                  @update:checked="toggleConversationSelection(conversation.id)"
                />
              </TableCell>
              <TableCell>
                <div class="flex items-center space-x-3">
                  <div>
                    <div class="font-medium">
                      {{ conversation.title || "Untitled Conversation" }}
                    </div>
                    <div class="text-xs text-neutral-muted">
                      {{ conversation.id.slice(0, 8) }}...
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge :variant="getStatusVariant(conversation?.status)">
                  <component :is="getStatusIcon(conversation?.status)" class="h-3 w-3 mr-1" />
                  {{ formatStatus(conversation?.status) }}
                </Badge>
              </TableCell>
              <TableCell class="text-sm">
                <div v-if="conversation.assignedUser" class="flex items-center space-x-2">
                  <div
                    class="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium"
                  >
                    {{ getInitials(conversation.assignedUser) }}
                  </div>
                  <span>{{ getFullName(conversation.assignedUser) }}</span>
                </div>
                <span v-else class="text-neutral-muted">-</span>
              </TableCell>
              <TableCell class="text-sm">
                {{ formatDuration(conversation.created_at, conversation.ended_at || new Date()) }}
              </TableCell>
              <TableCell>
                <div v-if="conversation.metadata?.satisfaction" class="flex items-center space-x-1">
                  <Star class="h-4 w-4 text-yellow-500 fill-current" />
                  <span class="text-sm">{{ conversation.metadata.satisfaction }}/5</span>
                </div>
                <span v-else class="text-xs text-neutral-muted">Not rated</span>
              </TableCell>
              <TableCell class="text-sm text-neutral-muted">
                {{ formatRelativeTime(conversation.updated_at) }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
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
  </Page>
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
  Star,
  Eye,
  UserCheck,
  MoreHorizontal,
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
import { useConversationTakeover } from "@/composables/useConversationTakeover";
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
const _realTimeEnabled = ref(true);
const searchQuery = ref("");
const selectedStatus = ref("");
const selectedAgent = ref("");
const selectedTimeframe = ref("week");
const bulkMode = ref(false);
const selectedConversations = ref<string[]>([]);
const currentPage = ref(1);
const pageSize = ref(10);

// API data
interface Conversation {
  id: string;
  title?: string;
  status: string;
  agent_id?: string;
  created_at: string;
  updated_at: string;
  ended_at?: string;
  metadata?: {
    satisfaction?: number;
  };
  assignedUser?: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
}

const conversations = ref<Conversation[]>([]);
const totalConversations = ref(0);

// Computed total pages
const totalPages = computed(() => Math.ceil(totalConversations.value / pageSize.value));

// Computed stats based on real conversations
const stats = computed(() => {
  const total = totalConversations.value;
  const active = conversations.value.filter(
    (c) => c.status === "open" || c.status === "processing",
  ).length;
  const resolved = conversations.value.filter((c) => c.status === "resolved").length;
  const today = conversations.value.filter((c) => {
    const created = new Date(c.created_at);
    const now = new Date();
    return created.toDateString() === now.toDateString();
  }).length;

  // Calculate average response time (mock for now)
  const avgResponseTime = 4.2;

  // Calculate satisfaction rate (mock for now)
  const satisfactionRate = resolved > 0 ? Math.round((resolved / total) * 100) : 0;

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

// Select options
const statusOptions = [
  { label: "All Status", value: "" },
  { label: "Active", value: "active" },
  { label: "Resolved", value: "resolved" },
  { label: "Escalated", value: "escalated" },
  { label: "Closed", value: "closed" },
];

const agentOptions = computed(() => [
  { label: "All Agents", value: "" },
  ...agents.value.map((agent) => ({ label: agent.name, value: agent.id })),
]);

const timeframeOptions = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
  { label: "All Time", value: "all" },
];

// For now, we'll use the conversations directly from API (already paginated)
// In the future, we should pass filters to the API
const filteredConversations = computed(() => {
  return conversations.value.filter((conversation) => {
    const matchesSearch =
      !searchQuery.value ||
      conversation.title?.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      conversation.id.toLowerCase().includes(searchQuery.value.toLowerCase());

    const matchesStatus = !selectedStatus.value || conversation.status === selectedStatus.value;

    const matchesAgent = !selectedAgent.value || conversation.agent_id === selectedAgent.value;

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
const getStatusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
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
    "pending-human": "Needs Attention",
    "human-took-over": "Manual Control",
    resolved: "Resolved",
    closed: "Closed",
  };
  return labels[status as keyof typeof labels] || status;
};

const getFullName = (user: any) => {
  if (!user) return "";
  if (user.firstName && user.lastName) {
    return `${user.firstName} ${user.lastName}`;
  }
  return user.firstName || user.lastName || user.email || "Unknown";
};

const getInitials = (user: any) => {
  if (!user) return "";
  if (user.firstName && user.lastName) {
    return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  }
  if (user.firstName) {
    return user.firstName[0].toUpperCase();
  }
  if (user.email) {
    return user.email[0].toUpperCase();
  }
  return "?";
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

const takeOverConversation = async (id: string) => {
  const { takeover } = useConversationTakeover();
  const success = await takeover(id);
  if (success) {
    // Refresh conversations list to show updated assigned user
    await fetchConversations();
  }
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
      include: ["assignedUser"],
    });

    conversations.value = response.items as any;
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
  await Promise.all([fetchConversations(), appStore.refreshConversationsCount()]);
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
  await Promise.all([fetchConversations(), appStore.refreshConversationsCount()]);
  // TODO: Fetch agents from API
  // TODO: Setup real-time updates via WebSocket
});

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
