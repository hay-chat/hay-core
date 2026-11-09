<template>
  <Card>
    <CardHeader>
      <div class="flex items-center justify-between">
        <div>
          <CardTitle>Active conversations</CardTitle>
          <CardDescription>Live list across Hay.chat + humans</CardDescription>
        </div>
        <div class="flex items-center gap-1">
          <RefreshIndicator :active="isRefreshing" />
          <Button variant="ghost" size="sm" @click="viewAll">
            View All
            <ChevronRight class="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </CardHeader>
    <CardContent>
      <div v-if="isLoading" class="space-y-3">
        <div v-for="i in 3" :key="i" class="animate-pulse">
          <div class="flex items-center justify-between p-3 border rounded-lg">
            <div class="flex-1 space-y-2">
              <div class="h-4 bg-background-tertiary rounded w-2/3"></div>
              <div class="h-3 bg-background-tertiary rounded w-1/2"></div>
            </div>
            <div class="h-8 w-24 bg-background-tertiary rounded"></div>
          </div>
        </div>
      </div>

      <div v-else-if="conversations.length === 0" class="text-center py-8 text-neutral-muted">
        <MessageSquare class="h-12 w-12 mx-auto mb-2 opacity-50" />
        <p>No active conversations</p>
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="conv in conversations"
          :key="conv.id"
          class="flex items-center justify-between p-3 border rounded-lg hover:bg-background-secondary transition-colors gap-3"
          :class="{ 'data-settle': isNewRow(conv.id) }"
        >
          <div class="flex-1 min-w-0 cursor-pointer" @click="viewConversation(conv.id)">
            <p class="font-medium text-foreground truncate">
              {{ formatCustomer(conv) }}
            </p>
            <div class="flex items-center gap-2 text-sm text-neutral-muted truncate">
              <span class="truncate">
                {{
                  conv.handler.type === "human"
                    ? `Human${conv.handler.name ? ` • ${conv.handler.name}` : ""}`
                    : "Hay.chat"
                }}
              </span>
              <span v-if="conv.lastMessageAt">• {{ formatRelativeTime(conv.lastMessageAt) }}</span>
            </div>
          </div>

          <div class="flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              :disabled="joiningId === conv.id || !conv.canJoin"
              @click="join(conv)"
            >
              <UserCheck class="h-4 w-4 mr-2" />
              Join
            </Button>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { HayApi } from "@/utils/api";
import { useConversationTakeover } from "@/composables/useConversationTakeover";
import { formatRelativeTime } from "~/utils/date";
import { ChevronRight, MessageSquare, UserCheck } from "lucide-vue-next";
import { useWebSocket } from "@/composables/useWebSocket";

type ActiveConversation = {
  id: string;
  title: string | null;
  customer: { name: string | null; externalId: string | null };
  status: string;
  handler:
    | { type: "hay"; name: string; userId: null }
    | { type: "human"; name: string | null; userId: string };
  lastMessageAt: string | null;
  updatedAt: string | null;
  canJoin: boolean;
};

const router = useRouter();
const websocket = useWebSocket();
const { takeover } = useConversationTakeover();

const query = useCachedQuery(
  () => ["conversations", "active"] as const,
  async () => (await HayApi.conversations.active.query()) as ActiveConversation[],
);

const conversations = computed(() => query.data.value ?? []);
const isNewRow = useNewRows(query.data, query.keyHash);
const joiningId = ref<string | null>(null);

const isLoading = query.loading;
const isRefreshing = query.refreshing;

const formatCustomer = (conv: ActiveConversation) => {
  return conv.title || conv.customer.name || conv.customer.externalId || conv.id.slice(0, 8);
};

const viewConversation = (id: string) => {
  router.push(`/conversations/${id}`);
};

const viewAll = () => {
  router.push("/conversations");
};

const join = async (conv: ActiveConversation) => {
  if (!conv.canJoin) return;
  joiningId.value = conv.id;
  try {
    const success = await takeover(conv.id);
    if (success) {
      router.push(`/conversations/${conv.id}`);
    }
  } finally {
    joiningId.value = null;
  }
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let unsubConversationUpdated: (() => void) | null = null;
let unsubConversationCreated: (() => void) | null = null;

onMounted(() => {
  // Poll as a baseline (works even without websockets)
  pollTimer = setInterval(() => void query.refresh(), 30_000);

  // Also refresh on websocket events for better “live” feel
  websocket.connect();
  unsubConversationUpdated = websocket.on("conversation_updated", () => {
    setTimeout(() => void query.refresh(), 200);
  });
  unsubConversationCreated = websocket.on("conversation_created", () => {
    setTimeout(() => void query.refresh(), 200);
  });
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (unsubConversationUpdated) unsubConversationUpdated();
  if (unsubConversationCreated) unsubConversationCreated();
});
</script>
