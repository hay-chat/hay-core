<template>
  <Card>
    <CardHeader>
      <div class="flex items-center justify-between">
        <div>
          <CardTitle>Attention Needed</CardTitle>
          <CardDescription>Conversations awaiting human response</CardDescription>
        </div>
        <Button variant="ghost" size="sm" @click="viewAllAttention">
          View All
          <ChevronRight class="ml-1 h-4 w-4" />
        </Button>
      </div>
    </CardHeader>
    <CardContent>
      <!-- Loading State -->
      <div v-if="isLoading && attentionConversations.length === 0" class="space-y-3">
        <div v-for="i in 3" :key="i" class="animate-pulse">
          <div class="flex items-center justify-between p-3 border rounded-lg">
            <div class="flex items-center space-x-3 flex-1">
              <div class="h-5 w-5 bg-background-tertiary rounded"></div>
              <div class="flex-1 space-y-2">
                <div class="h-4 bg-background-tertiary rounded w-3/4"></div>
                <div class="h-3 bg-background-tertiary rounded w-1/2"></div>
              </div>
            </div>
            <div class="h-6 w-16 bg-background-tertiary rounded-full"></div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-else-if="attentionConversations.length === 0"
        class="text-center py-8"
      >
        <CheckCircle class="h-12 w-12 mx-auto mb-2 opacity-50 text-green-500" />
        <p class="font-medium text-foreground">All caught up!</p>
        <p class="text-sm mt-2 text-neutral-muted">No conversations need attention</p>
      </div>

      <!-- Conversations List -->
      <div v-else class="space-y-3">
        <div
          v-for="conversation in attentionConversations"
          :key="conversation.id"
          class="flex items-center justify-between p-3 border rounded-lg hover:bg-background-secondary transition-colors cursor-pointer"
          @click="viewConversation(conversation.id)"
        >
          <!-- Left: Customer info -->
          <div class="flex items-center space-x-3 flex-1 min-w-0">
            <!-- Channel icon -->
            <div class="flex-shrink-0">
              <component
                :is="getChannelIcon(conversation.channel)"
                class="h-5 w-5 text-neutral-muted"
              />
            </div>

            <!-- Title and details -->
            <div class="flex-1 min-w-0">
              <p class="font-medium text-foreground truncate">
                {{ conversation.title || "Conversation" }}
              </p>
              <div class="flex items-center gap-2 text-sm text-neutral-muted">
                <!-- Assigned user if any -->
                <span v-if="conversation.assignedUser">
                  {{ getFullName(conversation.assignedUser) }}
                </span>
                <span v-else>Unassigned</span>
              </div>
            </div>
          </div>

          <!-- Right: Wait time badge -->
          <div class="flex-shrink-0 ml-3">
            <Badge :variant="getWaitTimeBadgeVariant(conversation.waitTime)">
              {{ formatWaitTime(conversation.waitTime) }}
            </Badge>
          </div>
        </div>
      </div>

      <!-- Refreshing indicator -->
      <div v-if="isRefreshing && attentionConversations.length > 0" class="mt-2 text-center">
        <RefreshCw class="h-4 w-4 inline animate-spin text-neutral-muted" />
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useRouter } from "vue-router";
import { HayApi } from "@/utils/api";
import { useAnalyticsStore } from "@/stores/analytics";
import { useWebSocket } from "@/composables/useWebSocket";
import { getWaitTime, formatWaitTime, getWaitTimeBadgeVariant, getFullName } from "@/utils/conversation";
import {
  MessageCircle,
  Globe,
  Phone,
  Mail,
  CheckCircle,
  ChevronRight,
  RefreshCw,
} from "lucide-vue-next";
// UI components are auto-imported by Nuxt

// Icons for different channels
const channelIcons = {
  web: Globe,
  whatsapp: MessageCircle,
  instagram: MessageCircle,
  telegram: MessageCircle,
  sms: Phone,
  email: Mail,
};

const getChannelIcon = (channel: string) => {
  return channelIcons[channel as keyof typeof channelIcons] || MessageCircle;
};

// State
const router = useRouter();
const analyticsStore = useAnalyticsStore();
const websocket = useWebSocket();

const CACHE_KEY = "dashboard_attention_needed";
const CACHE_TTL = 30 * 1000; // 30 seconds (shorter due to urgency)

interface AttentionConversation {
  id: string;
  title?: string;
  status: string;
  channel: string;
  assignedUser?: {
    id: string;
    first_name?: string;
    last_name?: string;
    email?: string;
  };
  messages?: Array<{
    type: string;
    created_at: string;
    content: string;
  }>;
  waitTime: number;
}

const attentionConversations = ref<AttentionConversation[]>([]);
const error = ref<string | null>(null);

// Computed loading states
const isLoading = computed(() => analyticsStore.isWidgetLoading(CACHE_KEY));
const isRefreshing = computed(() => analyticsStore.isWidgetRefreshing(CACHE_KEY));

// Fetch conversations needing attention
const fetchAttentionConversations = async (forceRefresh = false) => {
  try {
    error.value = null;

    const data = await analyticsStore.fetchData(
      CACHE_KEY,
      async () => {
        // Fetch both statuses in parallel
        const [pendingHumanResponse, takenOverResponse] = await Promise.all([
          HayApi.conversations.list.query({
            pagination: { page: 1, limit: 20 }, // Fetch more than 10 to account for filtering
            filters: { status: "pending-human" },
          }),
          HayApi.conversations.list.query({
            pagination: { page: 1, limit: 20 },
            filters: { status: "human-took-over" },
          }),
        ]);

        // Merge results from both queries
        const pendingHuman = pendingHumanResponse?.items || [];
        const takenOver = takenOverResponse?.items || [];
        const merged = [...pendingHuman, ...takenOver];

        // Calculate wait times and filter out those without valid wait times
        const withWaitTimes = merged
          .map((conv: any) => {
            const waitTime = getWaitTime(conv);
            return waitTime !== null ? { ...conv, waitTime } : null;
          })
          .filter((conv): conv is AttentionConversation => conv !== null);

        // Sort by longest wait time first and take top 10
        return withWaitTimes
          .sort((a, b) => b.waitTime - a.waitTime)
          .slice(0, 10);
      },
      { ttl: CACHE_TTL, forceRefresh }
    );

    attentionConversations.value = data || [];
  } catch (err) {
    console.error("Failed to fetch attention conversations:", err);
    error.value = "Failed to load conversations";
    attentionConversations.value = [];
  }
};

// Navigation handlers
const viewAllAttention = () => {
  router.push({
    path: "/conversations",
    query: {
      status: "pending-human",
    },
  });
};

const viewConversation = (id: string) => {
  router.push(`/conversations/${id}`);
};

// WebSocket event handlers
let unsubscribeConversationUpdated: (() => void) | null = null;
let unsubscribeMessageReceived: (() => void) | null = null;

const handleConversationUpdated = async (payload: any) => {
  const updatedConv = payload;

  // Check if status changed to/from attention-needed states
  const needsAttention =
    updatedConv.status === "pending-human" || updatedConv.status === "human-took-over";

  const isInList = attentionConversations.value.some((c) => c.id === updatedConv.id);

  if (needsAttention || isInList) {
    // Refresh the list after a small delay to avoid race conditions
    setTimeout(() => {
      fetchAttentionConversations(true);
    }, 200);
  }
};

const handleMessageReceived = async (payload: any) => {
  const { conversationId } = payload;

  // Check if this conversation is in our attention list
  const isInList = attentionConversations.value.some((c) => c.id === conversationId);

  if (isInList) {
    // Refresh to update wait times
    setTimeout(() => {
      fetchAttentionConversations(true);
    }, 200);
  }
};

// Lifecycle
onMounted(async () => {
  await fetchAttentionConversations();

  // Setup WebSocket listeners
  websocket.connect();

  unsubscribeConversationUpdated = websocket.on("conversation_updated", handleConversationUpdated);
  unsubscribeMessageReceived = websocket.on("message_received", handleMessageReceived);
});

onUnmounted(() => {
  // Cleanup WebSocket listeners
  if (unsubscribeConversationUpdated) {
    unsubscribeConversationUpdated();
  }
  if (unsubscribeMessageReceived) {
    unsubscribeMessageReceived();
  }
});
</script>
