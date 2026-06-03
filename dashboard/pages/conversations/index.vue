<template>
  <Page :title="$t('conversations.page.title')" :description="$t('conversations.page.description')">
    <!-- Header -->
    <template #header>
      <div class="flex items-center space-x-2">
        <Button @click="openPlayground">
          <Plus class="h-4 w-4 mr-2" />
          {{ $t("conversations.actions.playground") }}
        </Button>
        <Button variant="outline" @click="refreshConversations">
          <RefreshCcw class="h-4 w-4 mr-2" />
          {{ $t("conversations.actions.refresh") }}
        </Button>
      </div>
    </template>

    <!-- Stats Cards -->
    <div class="grid gap-4 md:grid-cols-3">
      <MetricCard
        :title="$t('conversations.stats.totalConversations')"
        :icon="MessageSquare"
        :metric="stats.total"
        :subtitle="$t('conversations.stats.todayIncrease', { count: stats.todayIncrease })"
      />

      <MetricCard
        :title="$t('conversations.stats.activeNow')"
        :icon="Activity"
        :metric="stats.active"
        :subtitle="$t('conversations.stats.realTimeConversations')"
      />

      <MetricCard
        :title="$t('conversations.stats.avgResponseTime')"
        :icon="Clock"
        :metric="`${stats.avgResponseTime}s`"
        :format-metric="false"
        :subtitle="$t('conversations.stats.yesterdayChange')"
        subtitle-color="green"
      />

      <!-- <MetricCard
        title="Satisfaction Rate"
        :icon="Heart"
        :metric="`${stats.satisfactionRate}%`"
        :format-metric="false"
        subtitle="+3.2% this week"
        subtitle-color="green"
      /> -->
    </div>

    <!-- Filters and Search -->
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <div class="min-w-[300px]">
          <Input
            v-model="searchQuery"
            :placeholder="$t('conversations.filters.searchPlaceholder')"
            :icon-start="Search"
          />
        </div>

        <Input
          v-model="selectedStatus"
          type="select"
          :options="statusOptions"
          :placeholder="$t('conversations.filters.allStatus')"
        />

        <Input v-model="selectedTimeframe" type="select" :options="timeframeOptions" />
      </div>

      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm" @click="toggleBulkMode">
          <CheckSquare class="h-4 w-4 mr-2" />
          {{ bulkMode ? $t("conversations.actions.exit") : $t("conversations.actions.select") }}
        </Button>
        <Button v-if="selectedConversations.length > 0" variant="outline" size="sm">
          <Archive class="h-4 w-4 mr-2" />
          {{ $t("conversations.actions.archive", { count: selectedConversations.length }) }}
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
      <Error :label="$t('conversations.error.loadingConversations')" />
      <p class="text-neutral-muted mb-4">
        {{ error }}
      </p>
      <Button variant="outline" @click="fetchConversations">
        <RefreshCcw class="h-4 w-4 mr-2" />
        {{ $t("conversations.actions.tryAgain") }}
      </Button>
    </div>

    <!-- Empty State -->
    <EmptyState
      v-else-if="filteredConversations.length === 0"
      :title="
        searchQuery
          ? $t('conversations.empty.noConversationsFound')
          : $t('conversations.empty.noConversationsYet')
      "
      :description="
        searchQuery ? $t('conversations.empty.adjustSearch') : $t('conversations.empty.startFirst')
      "
      illustration="/bale/conversation.svg"
      :action="searchQuery ? undefined : $t('conversations.actions.startPlayground')"
      @click="openPlayground"
    />

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
              <TableHead>{{ $t("conversations.table.conversation") }}</TableHead>
              <TableHead>{{ $t("conversations.table.status") }}</TableHead>
              <TableHead>{{ $t("conversations.table.assignedTo") }}</TableHead>
              <TableHead>{{ $t("conversations.table.duration") }}</TableHead>
              <TableHead>{{ $t("conversations.table.satisfaction") }}</TableHead>
              <TableHead>{{ $t("conversations.table.updated") }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="conversation in paginatedConversations"
              :key="conversation.id"
              :class="['cursor-pointer', getWaitTimeClass(getWaitTime(conversation))]"
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
                      {{ conversation.title || $t("conversations.table.newConversation") }}
                    </div>
                    <div class="text-xs text-neutral-muted">
                      {{ conversation.id.slice(0, 8) }}...
                    </div>
                    <div v-if="getWaitTime(conversation)" class="text-xs font-medium mt-1">
                      {{
                        $t("conversations.table.waiting", {
                          time: formatWaitTime(getWaitTime(conversation)!),
                        })
                      }}
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
                  <Avatar
                    :name="getFullName(conversation.assignedUser)"
                    :url="conversation.assignedUser.avatarUrl"
                    size="xs"
                  />
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
                <span v-else class="text-xs text-neutral-muted">{{
                  $t("conversations.table.notRated")
                }}</span>
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
  Search,
  RefreshCcw,
  CheckSquare,
  Archive,
  Star,
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
import { getWaitTime, formatWaitTime, getWaitTimeClass } from "@/utils/conversation";
import Avatar from "@/components/ui/Avatar.vue";

// i18n
const { t } = useI18n();

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
interface AssignedUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  avatarUrl?: string | null;
}

interface Conversation {
  id: string;
  title?: string;
  status: string;
  agent_id?: string;
  created_at: string;
  updated_at: string;
  ended_at?: string;
  lastMessageAt?: string;
  messages?: Array<{
    type: string;
    created_at: string;
  }>;
  metadata?: {
    satisfaction?: number;
  };
  assignedUser?: AssignedUser;
}

// WebSocket payload shapes for conversation events
type ConversationCreatedPayload = Conversation;
type ConversationUpdatedPayload = Partial<Conversation> & {
  id: string;
  changedFields?: string[];
};
interface ConversationDeletedPayload {
  id: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isConversationCreatedPayload(value: unknown): value is ConversationCreatedPayload {
  return isRecord(value) && typeof value.id === "string";
}

function isConversationUpdatedPayload(value: unknown): value is ConversationUpdatedPayload {
  return isRecord(value) && typeof value.id === "string";
}

function isConversationDeletedPayload(value: unknown): value is ConversationDeletedPayload {
  return isRecord(value) && typeof value.id === "string";
}

const conversations = ref<Conversation[]>([]);
const totalConversations = ref(0);

// Optional: show only conversations that had a takeover event in the selected period
const escalationsPeriod = ref<"today" | "week" | null>(null);

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

// Select options
const statusOptions = computed(() => [
  { label: t("conversations.filters.allStatus"), value: "" },
  { label: t("conversations.filters.active"), value: "active" },
  { label: t("conversations.filters.resolved"), value: "resolved" },
  { label: t("conversations.filters.escalated"), value: "escalated" },
  { label: t("conversations.filters.closed"), value: "closed" },
]);

const timeframeOptions = computed(() => [
  { label: t("conversations.filters.today"), value: "today" },
  { label: t("conversations.filters.thisWeek"), value: "week" },
  { label: t("conversations.filters.thisMonth"), value: "month" },
  { label: t("conversations.filters.allTime"), value: "all" },
]);

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
  const keys: Record<string, string> = {
    open: "conversations.status.open",
    processing: "conversations.status.processing",
    "pending-human": "conversations.status.pendingHuman",
    "human-took-over": "conversations.status.humanTookOver",
    resolved: "conversations.status.resolved",
    closed: "conversations.status.closed",
  };
  return keys[status] ? t(keys[status]) : status;
};

const getFullName = (user: AssignedUser | undefined) => {
  if (!user) return "";
  if (user.firstName && user.lastName) {
    return `${user.firstName} ${user.lastName}`;
  }
  return user.firstName || user.lastName || user.email || "Unknown";
};

// Wait time utilities imported from @/utils/conversation
// - getWaitTime(conversation): Calculate wait time in seconds
// - formatWaitTime(seconds): Format as "2m 30s"
// - getWaitTimeClass(seconds): Get CSS class for color coding

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

const openPlayground = () => {
  router.push("/conversations/playground");
};

const fetchConversations = async () => {
  try {
    loading.value = true;
    error.value = null;

    if (escalationsPeriod.value) {
      // Fetch conversations by takeover-event filter (no pagination)
      const response = await HayApi.conversations.escalatedConversations.query({
        period: escalationsPeriod.value,
        limit: 200,
      });
      conversations.value = response as unknown as Conversation[];
      totalConversations.value = conversations.value.length;
      currentPage.value = 1;
    } else {
      const response = await HayApi.conversations.list.query({
        pagination: { page: currentPage.value, limit: pageSize.value },
        sorting: { orderBy: "created_at", orderDirection: "desc" },
        include: ["assignedUser", "messages"],
      });

      conversations.value = response.items as unknown as Conversation[];
      totalConversations.value = response.pagination.total;
    }
  } catch (err) {
    console.error("Failed to fetch conversations:", err);
    error.value = t("conversations.error.failedToLoad");
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

// WebSocket setup
const { useWebSocket } = await import("@/composables/useWebSocket");
const websocket = useWebSocket();
let unsubscribeConversationCreated: (() => void) | null = null;
let unsubscribeConversationUpdated: (() => void) | null = null;
let unsubscribeConversationDeleted: (() => void) | null = null;

// Lifecycle
onMounted(async () => {
  // Check for query params to pre-filter
  const route = useRoute();
  if (route.query.status) {
    const statusParam = route.query.status as string;
    // Support single status or comma-separated statuses
    if (statusParam.includes("pending-human")) {
      selectedStatus.value = "pending-human";
    } else if (statusParam.includes("human-took-over")) {
      selectedStatus.value = "human-took-over";
    }
  }
  if (route.query.escalationsPeriod) {
    const period = route.query.escalationsPeriod as string;
    if (period === "today" || period === "week") {
      escalationsPeriod.value = period;
    }
  }

  await Promise.all([fetchConversations(), appStore.refreshConversationsCount()]);

  // Setup WebSocket connection for real-time updates
  websocket.connect();

  // Listen for new conversations
  unsubscribeConversationCreated = websocket.on(
    "conversation_created",
    async (payload: unknown) => {
      console.log("[Conversations List] Received conversation_created event", payload);
      if (isConversationCreatedPayload(payload)) {
        const newConversation = payload;

        // Only add if not already in list (avoid duplicates)
        const exists = conversations.value.some((c) => c.id === newConversation.id);
        if (!exists) {
          // Add to beginning of list (newest first)
          conversations.value.unshift(newConversation);
          totalConversations.value++;

          // Update stats
          await appStore.refreshConversationsCount();
        }
      }
    },
  );

  // Listen for conversation updates
  unsubscribeConversationUpdated = websocket.on(
    "conversation_updated",
    async (payload: unknown) => {
      console.log("[Conversations List] Received conversation_updated event", payload);
      if (isConversationUpdatedPayload(payload)) {
        const updatedData = payload;
        const index = conversations.value.findIndex((c) => c.id === updatedData.id);

        if (index !== -1) {
          // Update existing conversation
          conversations.value[index] = {
            ...conversations.value[index],
            ...updatedData,
          };

          // Update stats if status changed
          if (updatedData.changedFields?.includes("status")) {
            await appStore.refreshConversationsCount();
          }
        } else {
          // Conversation might have been filtered out, but status changed - refetch to be safe
          await fetchConversations();
        }
      }
    },
  );

  // Listen for conversation deletions
  unsubscribeConversationDeleted = websocket.on(
    "conversation_deleted",
    async (payload: unknown) => {
      console.log("[Conversations List] Received conversation_deleted event", payload);
      if (isConversationDeletedPayload(payload)) {
        const deletedId = payload.id;
        const index = conversations.value.findIndex((c) => c.id === deletedId);

        if (index !== -1) {
          // Remove from list
          conversations.value.splice(index, 1);
          totalConversations.value--;

          // Update stats
          await appStore.refreshConversationsCount();
        }
      }
    },
  );

  // TODO: Fetch agents from API
});

onUnmounted(() => {
  // Cleanup WebSocket event handlers
  if (unsubscribeConversationCreated) unsubscribeConversationCreated();
  if (unsubscribeConversationUpdated) unsubscribeConversationUpdated();
  if (unsubscribeConversationDeleted) unsubscribeConversationDeleted();
});

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: "auth",
});

// Head management
useHead({
  title: t("conversations.page.headTitle"),
  meta: [
    {
      name: "description",
      content: t("conversations.page.headDescription"),
    },
  ],
});
</script>

<style scoped>
.conversation-waiting-critical {
  @apply bg-red-100;
}
.conversation-waiting-urgent {
  @apply bg-orange-100;
}
.conversation-waiting-warning {
  @apply bg-yellow-100;
}
</style>
