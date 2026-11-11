<template>
  <Page :title="$t('conversations.page.title')" :description="$t('conversations.page.description')">
    <!-- Header -->
    <template #header>
      <div class="flex flex-wrap items-center gap-2">
        <RefreshIndicator :active="listRefreshing || statsRefreshing" />
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
        :metric="totalConversations"
        :loading="!listData"
        :subtitle="
          createdToday !== null
            ? $t('conversations.stats.todayIncrease', { count: createdToday })
            : undefined
        "
      />

      <MetricCard
        :title="$t('conversations.stats.activeNow')"
        :icon="Activity"
        :metric="appStore.openConversationsCount"
        :loading="appStore.isLoading && appStore.lastUpdated === null"
        :subtitle="$t('conversations.stats.realTimeConversations')"
      />

      <MetricCard
        :title="$t('conversations.stats.avgResponseTime')"
        :icon="Clock"
        :metric="
          responseTime && responseTime.sampleSize > 0
            ? formatWaitTime(responseTime.averageResponseTime)
            : '—'
        "
        :format-metric="false"
        :loading="statsLoading"
        :subtitle="
          responseTime && responseTime.sampleSize === 0
            ? $t('conversations.stats.noRepliesLast7Days')
            : $t('conversations.stats.last7Days')
        "
      />
    </div>

    <!-- Filters and Search -->
    <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <div class="w-full sm:min-w-[300px]">
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
      <Button variant="outline" @click="refreshList">
        <RefreshCcw class="h-4 w-4 mr-2" />
        {{ $t("conversations.actions.tryAgain") }}
      </Button>
    </div>

    <!-- Empty State -->
    <EmptyState
      v-else-if="paginatedConversations.length === 0"
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
        <div class="overflow-x-auto">
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
                <TableHead v-if="showChannelColumn">
                  {{ $t("conversations.table.channel") }}
                </TableHead>
                <TableHead>{{ $t("conversations.table.status") }}</TableHead>
                <TableHead class="hidden md:table-cell">
                  {{ $t("conversations.table.assignedTo") }}
                </TableHead>
                <TableHead class="hidden lg:table-cell">
                  {{ $t("conversations.table.duration") }}
                </TableHead>
                <TableHead class="hidden lg:table-cell">
                  {{ $t("conversations.table.satisfaction") }}
                </TableHead>
                <TableHead class="hidden lg:table-cell">
                  {{ $t("conversations.table.updated") }}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="conversation in paginatedConversations"
                :key="conversation.id"
                :class="[
                  'cursor-pointer',
                  getWaitTimeClass(getWaitTime(conversation)),
                  { 'data-settle': isNewRow(conversation.id) },
                ]"
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
                        {{
                          titleFor(conversation, "title") ||
                          $t("conversations.table.newConversation")
                        }}
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
                      <div class="md:hidden text-xs text-neutral-muted mt-1">
                        <template v-if="conversation.assignedUser">
                          {{ getFullName(conversation.assignedUser) }} &middot;
                        </template>
                        {{ formatRelativeTime(conversation.updated_at) }}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell v-if="showChannelColumn">
                  <div class="flex items-center gap-2">
                    <component
                      :is="getChannelIcon(conversation.channel)"
                      class="h-4 w-4 text-neutral-muted shrink-0"
                    />
                    <span class="text-sm">{{ getChannelLabel(conversation.channel) }}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <SettleValue :value="conversation?.status">
                    <Badge :variant="getStatusVariant(conversation?.status)">
                      <component :is="getStatusIcon(conversation?.status)" class="h-3 w-3 mr-1" />
                      {{ formatStatus(conversation?.status) }}
                    </Badge>
                  </SettleValue>
                </TableCell>
                <TableCell class="hidden md:table-cell text-sm">
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
                <TableCell class="hidden lg:table-cell text-sm">
                  {{ formatDuration(conversation.created_at, conversation.ended_at || new Date()) }}
                </TableCell>
                <TableCell class="hidden lg:table-cell">
                  <div
                    v-if="conversation.metadata?.satisfaction"
                    class="flex items-center space-x-1"
                  >
                    <Star class="h-4 w-4 text-yellow-500 fill-current" />
                    <span class="text-sm">{{ conversation.metadata.satisfaction }}/5</span>
                  </div>
                  <span v-else class="text-xs text-neutral-muted">{{
                    $t("conversations.table.notRated")
                  }}</span>
                </TableCell>
                <TableCell class="hidden lg:table-cell text-sm text-neutral-muted">
                  {{ formatRelativeTime(conversation.updated_at) }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
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
  </Page>
</template>

<script setup lang="ts">
import { logger } from "@/utils/logger";
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
  Hourglass,
  XCircle,
  Plus,
} from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { useRouter } from "vue-router";
import { useAppStore } from "@/stores/app";
import { formatRelativeTime, formatDuration, toLocalDateString } from "~/utils/date";
import { getWaitTime, formatWaitTime, getWaitTimeClass } from "@/utils/conversation";
import {
  statusesForFilter,
  timeframeStart,
  type StatusFilter,
  type TimeframeFilter,
} from "@/utils/conversation-filters";
import { getEnabledChannelPlugins } from "@/utils/channel";
import Avatar from "@/components/ui/Avatar.vue";
import { useConversationTextTranslations } from "@/composables/useTextTranslations";
import type { RouterOutputs } from "@/types/trpc";

// i18n
const { t } = useI18n();

// Router
const router = useRouter();

// Stores
const appStore = useAppStore();

// Reactive state
const _realTimeEnabled = ref(true);
const searchQuery = ref("");
// A deep link with a human status (e.g. from Home) opens on the Escalated filter.
const route = useRoute();
const initialStatus = String(route.query.status ?? "");
const selectedStatus = ref<StatusFilter>(
  initialStatus.includes("pending-human") || initialStatus.includes("human-took-over")
    ? "escalated"
    : "",
);
const selectedTimeframe = ref<TimeframeFilter>("all");
const bulkMode = ref(false);
const selectedConversations = ref<string[]>([]);
const { page: currentPage, pageSize, setPage, setPageSize } = usePagination();

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
  channel?: string;
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

// Optional: show only conversations that had a takeover event in the selected period
const requestedPeriod = route.query.escalationsPeriod;
const escalationsPeriod: "today" | "week" | null =
  requestedPeriod === "today" || requestedPeriod === "week" ? requestedPeriod : null;
if (escalationsPeriod) currentPage.value = 1;

// Typing in search waits a beat before it becomes part of the query.
const appliedSearch = ref("");

interface ConversationPage {
  items: Conversation[];
  total: number;
}

const {
  data: listData,
  loading,
  refreshing: listRefreshing,
  error: listError,
  keyHash: listKeyHash,
  refresh: refreshList,
  setData: setListData,
} = useCachedQuery(
  () =>
    [
      "conversations",
      "list",
      escalationsPeriod
        ? { escalationsPeriod }
        : {
            status: selectedStatus.value,
            timeframe: selectedTimeframe.value,
            search: appliedSearch.value,
            page: currentPage.value,
            limit: pageSize.value,
          },
    ] as const,
  async ([, , params]): Promise<ConversationPage> => {
    if (params.escalationsPeriod) {
      // Conversations by takeover event (no pagination)
      const response = await HayApi.conversations.escalatedConversations.query({
        period: params.escalationsPeriod,
        limit: 200,
      });
      const items = response as unknown as Conversation[];
      return { items, total: items.length };
    }
    const statuses = statusesForFilter(params.status);
    const from = timeframeStart(params.timeframe);
    const response = await HayApi.conversations.list.query({
      filters: statuses ? { statuses } : undefined,
      dateRange: from ? { from: from.toISOString() } : undefined,
      search: params.search ? { query: params.search } : undefined,
      pagination: { page: params.page, limit: params.limit },
      sorting: { orderBy: "created_at", orderDirection: "desc" },
      include: ["assignedUser", "messages"],
    });
    return {
      items: response.items as unknown as Conversation[],
      total: response.pagination.total,
    };
  },
);

const conversations = computed(() => listData.value?.items ?? []);
const totalConversations = computed(() => listData.value?.total ?? 0);
const isNewRow = useNewRows(() => listData.value?.items, listKeyHash);
// With rows on screen a failed refresh keeps them; only a first load shows the error.
const error = computed(() =>
  listError.value && !listData.value ? t("conversations.error.failedToLoad") : null,
);

// Computed total pages
const totalPages = computed(() => Math.ceil(totalConversations.value / pageSize.value));

// Show the channel column only when the org has more than one channel in play.
// "web" is always available, so a single enabled channel plugin already means 2+.
// Channel labels/icons are resolved from the plugin registry via @/utils/channel
// (getChannelIcon / getChannelLabel) — core never hardcodes channel names.
const showChannelColumn = computed(() => getEnabledChannelPlugins().length >= 1);

// Header stats come from the server so they cover the whole organization, not
// just the page of conversations loaded here. Null = not loaded (or no access).
type ResponseTime = RouterOutputs["analytics"]["responseTime"]["data"];
const {
  data: headerStats,
  loading: statsLoading,
  refreshing: statsRefreshing,
  refresh: refreshHeaderStats,
} = useCachedQuery(
  // The key rolls over at midnight; the fetcher works out its own window.
  () => ["analytics", "conversations-header", toLocalDateString(new Date())] as const,
  async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [today, replies] = await Promise.allSettled([
      HayApi.analytics.conversationMetrics.query({ startDate: startOfToday.toISOString() }),
      HayApi.analytics.responseTime.query({ startDate: sevenDaysAgo.toISOString() }),
    ]);
    return {
      createdToday: today.status === "fulfilled" ? today.value.data.totalConversations : null,
      responseTime: replies.status === "fulfilled" ? (replies.value.data as ResponseTime) : null,
    };
  },
);
const createdToday = computed(() => headerStats.value?.createdToday ?? null);
const responseTime = computed(() => headerStats.value?.responseTime ?? null);

// Select options
const statusOptions = computed(() => [
  { label: t("conversations.filters.allStatus"), value: "" },
  { label: t("conversations.filters.active"), value: "active" },
  { label: t("conversations.filters.resolved"), value: "resolved" },
  { label: t("conversations.filters.unresolved"), value: "unresolved" },
  { label: t("conversations.filters.escalated"), value: "escalated" },
  { label: t("conversations.filters.closed"), value: "closed" },
]);

const timeframeOptions = computed(() => [
  { label: t("conversations.filters.today"), value: "today" },
  { label: t("conversations.filters.thisWeek"), value: "week" },
  { label: t("conversations.filters.thisMonth"), value: "month" },
  { label: t("conversations.filters.allTime"), value: "all" },
]);

// Search, status and timeframe are applied by the server (see fetchConversations),
// so the loaded page and its total always agree.
const paginatedConversations = computed(() => conversations.value);
// Titles of the rows on screen in the reader's translation language.
const { textFor: titleFor } = useConversationTextTranslations(paginatedConversations, ["title"]);

// Methods
const getStatusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    open: "default",
    "pending-human": "destructive",
    "awaiting-approval": "outline",
    resolved: "secondary",
    unresolved: "outline",
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
    "awaiting-approval": Hourglass,
    resolved: CheckCircle,
    unresolved: XCircle,
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
    "awaiting-approval": "conversations.status.awaitingApproval",
    "human-took-over": "conversations.status.humanTookOver",
    resolved: "conversations.status.resolved",
    unresolved: "conversations.status.unresolved",
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
// - formatWaitTime(seconds): Format as "2m 30s", "5h 12m" or "3d 4h"
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

const refreshConversations = async () => {
  await Promise.all([refreshList(), appStore.refreshConversationsCount(), refreshHeaderStats()]);
};

// Any filter change goes back to page 1. Sync, so the query never sees the new
// filter with the old page and fetches twice.
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchQuery, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    setPage(1);
    appliedSearch.value = searchQuery.value.trim();
  }, 300);
});
watch([selectedStatus, selectedTimeframe], () => setPage(1), { flush: "sync" });

const handlePageChange = (page: number) => {
  setPage(page);
};

const handleItemsPerPageChange = (itemsPerPage: number) => {
  setPageSize(itemsPerPage); // Resets to page 1, persists the preference, syncs the URL
};

// WebSocket setup
const { useWebSocket } = await import("@/composables/useWebSocket");
const websocket = useWebSocket();
let unsubscribeConversationCreated: (() => void) | null = null;
let unsubscribeConversationUpdated: (() => void) | null = null;
let unsubscribeConversationDeleted: (() => void) | null = null;

// Lifecycle
onMounted(async () => {
  await Promise.all([appStore.refreshConversationsCount(), appStore.fetchPlugins()]);

  // Setup WebSocket connection for real-time updates
  websocket.connect();

  // Listen for new conversations
  unsubscribeConversationCreated = websocket.on(
    "conversation_created",
    async (payload: unknown) => {
      logger.debug("[Conversations List] Received conversation_created event", payload);
      if (isConversationCreatedPayload(payload)) {
        const newConversation = payload;

        // Only add if not already in list (avoid duplicates)
        const exists = conversations.value.some((c) => c.id === newConversation.id);
        // Add to beginning of list (newest first)
        setListData((page) =>
          page.items.some((c) => c.id === newConversation.id)
            ? page
            : { items: [newConversation, ...page.items], total: page.total + 1 },
        );
        if (!exists) {
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
      logger.debug("[Conversations List] Received conversation_updated event", payload);
      if (isConversationUpdatedPayload(payload)) {
        const updatedData = payload;
        const isListed = conversations.value.some((c) => c.id === updatedData.id);

        if (isListed) {
          // Update existing conversation
          setListData((page) => ({
            ...page,
            items: page.items.map((c) => (c.id === updatedData.id ? { ...c, ...updatedData } : c)),
          }));

          // Update stats if status changed
          if (updatedData.changedFields?.includes("status")) {
            await appStore.refreshConversationsCount();
          }
        } else {
          // Conversation might have been filtered out, but status changed - refetch to be safe
          await refreshList();
        }
      }
    },
  );

  // Listen for conversation deletions
  unsubscribeConversationDeleted = websocket.on(
    "conversation_deleted",
    async (payload: unknown) => {
      logger.debug("[Conversations List] Received conversation_deleted event", payload);
      if (isConversationDeletedPayload(payload)) {
        const deletedId = payload.id;
        const wasListed = conversations.value.some((c) => c.id === deletedId);

        if (wasListed) {
          // Remove from list
          setListData((page) => {
            const items = page.items.filter((c) => c.id !== deletedId);
            return { items, total: page.total - (page.items.length - items.length) };
          });

          // Update stats
          await appStore.refreshConversationsCount();
        }
      }
    },
  );

  // TODO: Fetch agents from API
});

onUnmounted(() => {
  clearTimeout(searchTimer);
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
