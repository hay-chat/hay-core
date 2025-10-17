<template>
  <div class="h-screen flex flex-col">
    <!-- Header -->
    <div
      class="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <div class="flex items-center justify-between px-6 py-4">
        <div class="flex items-center space-x-4">
          <Button variant="ghost" @click="goBack">
            <ArrowLeft class="h-4 w-4 mr-2" />
            Back to Conversations
          </Button>
          <div>
            <h1 class="text-xl font-semibold">
              {{ conversation?.title || "Loading..." }}
            </h1>
            <p class="text-sm text-neutral-muted">
              Conversation #{{ conversation?.id?.slice(0, 8) }}
            </p>
          </div>
        </div>
        <div class="flex items-center space-x-2">
          <Badge :variant="getStatusVariant(conversation?.status)">
            <component :is="getStatusIcon(conversation?.status)" class="h-3 w-3 mr-1" />
            {{ formatStatus(conversation?.status) }}
          </Badge>
          <Badge
            v-if="isTestMode"
            :variant="isTestMode ? 'default' : 'secondary'"
            class="bg-orange-100 text-orange-700 hover:bg-orange-200"
          >
            <ShieldAlert class="h-3 w-3 mr-1" />
            Test Mode: {{ isTestMode ? "ON" : "OFF" }}
          </Badge>
          <Button variant="outline" size="sm" @click="exportConversation">
            <Download class="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button
            v-if="conversation?.status === 'open'"
            variant="outline"
            size="sm"
            :class="supervisionMode ? 'bg-orange-50 border-orange-200' : ''"
            @click="toggleSupervisionMode"
          >
            <Eye class="h-4 w-4 mr-2" />
            {{ supervisionMode ? "Exit Supervision" : "Supervise" }}
          </Button>
          <Button
            v-if="conversation?.status === 'open' || conversation?.status === 'pending-human'"
            size="sm"
            @click="takeOverConversation"
          >
            <UserCheck class="h-4 w-4 mr-2" />
            Take Over
          </Button>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left Side: Conversation Thread -->
      <div class="flex-1 flex flex-col">
        <!-- Messages Container -->
        <div ref="messagesContainer" class="flex-1 overflow-y-auto p-6 space-y-4">
          <div v-if="loading" class="space-y-4">
            <div v-for="i in 5" :key="i" class="animate-pulse">
              <div class="flex space-x-3">
                <div class="w-8 h-8 bg-gray-200 rounded-full" />
                <div class="flex-1">
                  <div class="h-3 bg-gray-200 rounded w-1/4 mb-2" />
                  <div class="h-10 bg-gray-200 rounded w-3/4" />
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="conversation?.messages?.length === 0" class="text-center py-12">
            <MessageSquare class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
            <p class="text-neutral-muted">No messages in this conversation yet</p>
          </div>

          <div v-else class="space-y-4">
            <!-- Conversation Start -->
            <div class="text-center">
              <div
                class="inline-flex items-center px-3 py-1 bg-background-tertiary rounded-full text-sm text-neutral-muted"
              >
                <Clock class="h-3 w-3 mr-1" />
                Conversation started {{ formatDate(conversation?.created_at) }}
              </div>
            </div>

            <!-- Messages -->
            <TransitionGroup
              enter-active-class="transition duration-100 ease-out"
              enter-from-class="transform scale-95 opacity-0"
              enter-to-class="transform scale-100 opacity-100"
              leave-active-class="transition duration-75 ease-in"
              leave-from-class="transform scale-100 opacity-100"
              leave-to-class="transform scale-95 opacity-0"
            >
              <ChatMessage
                v-for="message in conversation?.messages"
                :key="message.id"
                :message="message"
                :show-feedback="true"
                :show-approval="isTestMode"
                @message-approved="handleMessageApproved"
                @message-blocked="handleMessageBlocked"
                @feedback-submitted="handleFeedbackSubmitted"
              />
            </TransitionGroup>

            <!-- Typing indicator -->
            <div v-if="isTyping" class="flex space-x-3 max-w-2xl">
              <div class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                <User class="h-4 w-4 text-primary" />
              </div>
              <div class="flex-1">
                <div class="bg-background-tertiary p-3 rounded-lg">
                  <div class="flex space-x-1">
                    <div
                      class="w-2 h-2 bg-background-tertiary-foreground/50 rounded-full animate-bounce"
                    />
                    <div
                      class="w-2 h-2 bg-background-tertiary-foreground/50 rounded-full animate-bounce"
                      style="animation-delay: 0.1s"
                    />
                    <div
                      class="w-2 h-2 bg-background-tertiary-foreground/50 rounded-full animate-bounce"
                      style="animation-delay: 0.2s"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Human Takeover Panel -->
        <div v-if="isTakenOverByCurrentUser" class="border-t bg-blue-50 p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <UserCheck class="h-4 w-4 text-blue-600" />
              <span class="text-sm font-medium text-blue-800"
                >You are handling this conversation</span
              >
            </div>
            <div class="flex items-center space-x-2">
              <Button variant="outline" size="sm" @click="endTakeover"> Release Conversation </Button>
              <Button variant="outline" size="sm" @click="showCloseDialog = true">
                Close Conversation
              </Button>
            </div>
          </div>
        </div>

        <!-- Message Input (when conversation is taken over by current user) -->
        <div v-if="isTakenOverByCurrentUser" class="border-t p-4">
          <form @submit.prevent="sendMessage" class="flex space-x-3">
            <Input v-model="newMessage" placeholder="Type your message..." class="flex-1" />
            <Button type="submit" :disabled="!newMessage.trim() || isSendingMessage">
              <Send class="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>

      <!-- Right Side: Context Panel -->
      <div class="w-80 border-l bg-background-tertiary">
        <div class="p-6 space-y-6">
          <!-- Customer Information -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base"> Customer Information </CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="flex items-center space-x-3">
                <div class="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <User class="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div class="font-medium">Customer</div>
                  <div class="text-sm text-neutral-muted">
                    {{ conversation?.id?.slice(0, 8) }}
                  </div>
                </div>
              </div>
              <div class="space-y-2 text-sm">
                <div class="flex justify-between">
                  <span class="text-neutral-muted">Conversation ID:</span>
                  <span class="font-mono text-xs">{{ conversation?.id?.slice(0, 8) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-neutral-muted">Status:</span>
                  <span>{{ conversation?.status }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-neutral-muted">Created:</span>
                  <span>{{ formatDate(conversation?.created_at) }}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- Conversation Details -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base"> Conversation Details </CardTitle>
            </CardHeader>
            <CardContent class="space-y-3 text-sm">
              <div class="flex justify-between">
                <span class="text-neutral-muted">Agent:</span>
                <span>{{ conversation?.agent?.name || "AI Assistant" }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-neutral-muted">Status:</span>
                <span>{{ formatStatus(conversation?.status) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-neutral-muted">Messages:</span>
                <span>{{ conversation?.messages?.length }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-neutral-muted">Created:</span>
                <span>{{ formatDate(conversation?.created_at) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-neutral-muted">Updated:</span>
                <span>{{ formatDate(conversation?.updated_at) }}</span>
              </div>
            </CardContent>
          </Card>

          <!-- Previous Conversations -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base"> Previous Conversations </CardTitle>
            </CardHeader>
            <CardContent>
              <div v-if="previousConversations.length === 0" class="text-sm text-neutral-muted">
                No previous conversations
              </div>
              <div v-else class="space-y-3">
                <div
                  v-for="prevConv in previousConversations"
                  :key="prevConv.id"
                  class="p-3 border rounded-md hover:bg-background-secondary cursor-pointer"
                  @click="viewConversation(prevConv.id)"
                >
                  <div class="text-sm font-medium">
                    {{ prevConv.subject || prevConv.title }}
                  </div>
                  <div class="text-xs text-neutral-muted">
                    {{ formatDate(prevConv.createdAt || prevConv.date) }} •
                    {{ prevConv.status || "Unknown" }}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- Available Actions -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base"> Quick Actions </CardTitle>
            </CardHeader>
            <CardContent class="space-y-2">
              <Button variant="outline" size="sm" class="w-full justify-start">
                <Ticket class="h-4 w-4 mr-2" />
                Create Support Ticket
              </Button>
              <Button variant="outline" size="sm" class="w-full justify-start">
                <Mail class="h-4 w-4 mr-2" />
                Send Email
              </Button>
              <Button variant="outline" size="sm" class="w-full justify-start">
                <Phone class="h-4 w-4 mr-2" />
                Schedule Call
              </Button>
              <Button variant="outline" size="sm" class="w-full justify-start">
                <Star class="h-4 w-4 mr-2" />
                Request Feedback
              </Button>
            </CardContent>
          </Card>

          <!-- Knowledge Base Articles -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base"> Related Articles </CardTitle>
            </CardHeader>
            <CardContent>
              <div class="space-y-2">
                <div
                  v-for="article in relatedArticles"
                  :key="article.id"
                  class="p-2 border rounded text-sm hover:bg-background-secondary cursor-pointer"
                >
                  <div class="font-medium">
                    {{ article.title }}
                  </div>
                  <div class="text-xs text-neutral-muted">
                    {{ article.category || "General" }}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>

    <!-- Release Dialog -->
    <Dialog v-model:open="showReleaseDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Release Conversation</DialogTitle>
          <DialogDescription>
            How would you like to handle this conversation after releasing it?
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="flex items-start space-x-3">
            <input id="release-ai" v-model="releaseMode" type="radio" value="ai" class="mt-1" />
            <label for="release-ai" class="flex-1 cursor-pointer">
              <div class="font-medium">Return to AI</div>
              <div class="text-sm text-neutral-muted">
                The AI will continue processing this conversation automatically
              </div>
            </label>
          </div>
          <div class="flex items-start space-x-3">
            <input
              id="release-queue"
              v-model="releaseMode"
              type="radio"
              value="queue"
              class="mt-1"
            />
            <label for="release-queue" class="flex-1 cursor-pointer">
              <div class="font-medium">Return to Queue</div>
              <div class="text-sm text-neutral-muted">
                Another agent can take over this conversation
              </div>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showReleaseDialog = false"> Cancel </Button>
          <Button @click="confirmRelease"> Release </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Close Dialog -->
    <Dialog v-model:open="showCloseDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close Conversation</DialogTitle>
          <DialogDescription>
            Are you sure you want to close this conversation? This will mark it as resolved and
            closed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showCloseDialog = false"> Cancel </Button>
          <Button @click="confirmClose"> Close Conversation </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowLeft,
  Download,
  Eye,
  UserCheck,
  MessageSquare,
  Clock,
  Send,
  AlertTriangle,
  Star,
  Ticket,
  Mail,
  Phone,
  Circle,
  CheckCircle,
  XCircle,
  User,
  ShieldAlert,
} from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import Badge from "@/components/ui/Badge.vue";
import Dialog from "@/components/ui/Dialog.vue";
import DialogContent from "@/components/ui/DialogContent.vue";
import DialogDescription from "@/components/ui/DialogDescription.vue";
import DialogFooter from "@/components/ui/DialogFooter.vue";
import DialogHeader from "@/components/ui/DialogHeader.vue";
import DialogTitle from "@/components/ui/DialogTitle.vue";

import { MessageType } from "~/types/message";

interface Message {
  id: string;
  type: MessageType | string;
  content: string;
  metadata?: Record<string, unknown> | null;
  needsApproval?: boolean;
  created_at: string;
  conversation_id: string;
  updated_at: string;
  status: string;
}

interface Agent {
  id: string;
  name: string;
}

interface ConversationData {
  id: string;
  title?: string | null;
  status: string;
  cooldown_until?: string | null;
  created_at: string;
  updated_at: string;
  messages?: Message[];
  agent?: Agent;
}

interface PreviousConversation {
  id: string;
  title: string;
  date: string;
  subject?: string;
  createdAt?: string;
  status?: string;
}

interface RelatedArticle {
  id: string;
  title: string;
  url: string;
  snippet: string;
  category?: string;
}

// Get conversation ID from route
const route = useRoute();
const conversationId = route.params["id"] as string;

// Reactive state
const loading = ref(true);
const supervisionMode = ref(false);
const humanTakeover = ref(false);
const isTyping = ref(false);
const newMessage = ref("");
const messagesContainer = ref<HTMLElement>();

// Data from API - Use any to handle multiple possible response formats
const conversation = ref<any>(null);

const previousConversations = ref<PreviousConversation[]>([]);
const relatedArticles = ref<RelatedArticle[]>([]);

// Takeover state
const { useUserStore } = await import("@/stores/user");
const userStore = useUserStore();
const currentUserId = computed(() => userStore.user?.id);
const assignedUser = ref<any>(null);
const showReleaseDialog = ref(false);
const showCloseDialog = ref(false);
const releaseMode = ref<"ai" | "queue">("queue");

// Check if conversation is taken over by current user
const isTakenOverByCurrentUser = computed(() => {
  return (
    conversation.value?.status === "human-took-over" &&
    assignedUser.value?.id === currentUserId.value
  );
});

// Check if test mode is enabled for this conversation
const isTestMode = computed(() => {
  const agent = conversation.value?.agent;
  if (!agent) return false;

  // Check agent's testMode setting
  // If agent has explicit setting, use it; otherwise check org default
  return agent.testMode ?? false; // TODO: Fetch org default from settings
});

// Message approval handlers
const handleMessageApproved = async (messageId: string) => {
  console.log("Message approved:", messageId);
  // Reload conversation to get updated messages
  await fetchConversation();
};

const handleMessageBlocked = async (messageId: string) => {
  console.log("Message blocked:", messageId);
  // Reload conversation to get updated messages
  await fetchConversation();
};

const handleFeedbackSubmitted = () => {
  console.log("Feedback submitted");
  // Optional: Show toast or update UI
};

const goBack = () => {
  navigateTo("/conversations");
};

const getStatusVariant = (
  status: string | undefined,
): "default" | "secondary" | "destructive" | "outline" | undefined => {
  if (!status) return "outline";
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    open: "default",
    "pending-human": "destructive",
    resolved: "secondary",
    processing: "outline",
    closed: "secondary",
  };
  return variants[status] || "default";
};

const getStatusIcon = (status: string | undefined) => {
  if (!status) return Circle;
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

const formatStatus = (status: string | undefined) => {
  if (!status) return "Unknown";
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

const formatCountdown = (cooldownUntil: Date | string) => {
  const target = new Date(cooldownUntil);
  const now = new Date();
  const seconds = Math.floor((target.getTime() - now.getTime()) / 1000);

  if (seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

const formatDate = (date: Date | string | undefined) => {
  if (!date) return "N/A";
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dateObj);
};

// formatDuration function removed - was unused

const toggleSupervisionMode = () => {
  supervisionMode.value = !supervisionMode.value;
  // TODO: Enable/disable supervision mode
  console.log("Supervision mode:", supervisionMode.value);
};

const takeOverConversation = async () => {
  const { useToast } = await import("@/composables/useToast");
  const toast = useToast();

  try {
    await HayApi.conversations.takeover.mutate({
      conversationId,
    });
    humanTakeover.value = true;
    supervisionMode.value = false;
    toast.success("Conversation taken over", "You are now handling this conversation");
    // Refresh conversation and assigned user
    await fetchConversation();
    assignedUser.value = await HayApi.conversations.getAssignedUser.query({ conversationId });
  } catch (error: any) {
    console.error("Failed to take over conversation:", error);
    const errorMessage = error?.message || error?.data?.message || "Failed to take over conversation";
    toast.error("Takeover failed", errorMessage);
  }
};

const endTakeover = () => {
  // Show dialog to choose release mode
  showReleaseDialog.value = true;
};

const confirmRelease = async () => {
  const { useToast } = await import("@/composables/useToast");
  const toast = useToast();

  try {
    await HayApi.conversations.release.mutate({
      conversationId,
      returnToMode: releaseMode.value,
    });
    humanTakeover.value = false;
    assignedUser.value = null;
    showReleaseDialog.value = false;
    const message =
      releaseMode.value === "ai"
        ? "Conversation returned to AI"
        : "Conversation returned to queue";
    toast.success("Conversation released", message);
    // Refresh conversation to get updated status
    await fetchConversation();
  } catch (error: any) {
    console.error("Failed to release conversation:", error);
    const errorMessage = error?.message || error?.data?.message || "Failed to release conversation";
    toast.error("Release failed", errorMessage);
  }
};

const confirmClose = async () => {
  const { useToast } = await import("@/composables/useToast");
  const toast = useToast();

  try {
    await HayApi.conversations.close.mutate({
      conversationId,
    });
    showCloseDialog.value = false;
    toast.success("Conversation closed", "This conversation has been marked as closed");
    // Refresh conversation to get updated status
    await fetchConversation();
  } catch (error: any) {
    console.error("Failed to close conversation:", error);
    const errorMessage = error?.message || error?.data?.message || "Failed to close conversation";
    toast.error("Close failed", errorMessage);
  }
};

// Track if message is being sent to prevent duplicate sends
const isSendingMessage = ref(false);

const sendMessage = async () => {
  if (!newMessage.value.trim() || isSendingMessage.value) return;

  isSendingMessage.value = true;
  const messageContent = newMessage.value;
  newMessage.value = ""; // Clear immediately to prevent double-send

  try {
    // Send message via API
    // When conversation is taken over by current user, send as assistant (human agent)
    const role = isTakenOverByCurrentUser.value ? "assistant" : "user";
    const messageType = isTakenOverByCurrentUser.value
      ? MessageType.HUMAN_AGENT
      : MessageType.CUSTOMER;

    const result = await HayApi.conversations.sendMessage.mutate({
      conversationId,
      content: messageContent,
      role,
    });

    // Play message sent sound
    playSound("/sounds/message-sent.mp3");

    // Add message to local list
    if (conversation.value && conversation.value.messages) {
      conversation.value.messages.push({
        id: result.id,
        content: messageContent,
        type: messageType,
        created_at: new Date().toISOString(),
        conversation_id: conversationId,
        updated_at: new Date().toISOString(),
        status: "approved",
      });
    }

    scrollToBottom();

    // Refresh messages after a short delay to get any AI response (skip if taken over)
    if (!isTakenOverByCurrentUser.value) {
      setTimeout(() => fetchConversation(), 2000);
    }
  } catch (error) {
    console.error("Failed to send message:", error);
    // Restore message on error
    newMessage.value = messageContent;
  } finally {
    isSendingMessage.value = false;
  }
};

const approveMessage = (messageId: string) => {
  // TODO: Approve agent message
  console.log("Approve message:", messageId);
  // const message = conversation.value.messages.find((m) => m.id === messageId);
  // if (message) {
  //   message.needsApproval = false;
  // }
};

const editMessage = (messageId: string) => {
  // TODO: Open message editor
  console.log("Edit message:", messageId);
};

const rejectMessage = (messageId: string) => {
  // TODO: Reject agent message
  console.log("Reject message:", messageId);
};

const exportConversation = () => {
  // TODO: Export conversation
  console.log("Export conversation");
};

const viewConversation = (id: string) => {
  navigateTo(`/conversations/${id}`);
};

const scrollToBottom = () => {
  // eslint-disable-next-line no-undef
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
};

// Track previous message count to detect new messages
const previousMessageCount = ref(0);

// Fetch conversation data
const fetchConversation = async () => {
  try {
    // Only show loading skeleton on initial load
    if (!conversation.value) {
      loading.value = true;
    }
    const result = await HayApi.conversations.get.query({ id: conversationId });

    // Check if new messages were received
    const currentMessageCount = result.messages?.length || 0;
    if (previousMessageCount.value > 0 && currentMessageCount > previousMessageCount.value) {
      // Get the new messages
      const newMessagesCount = currentMessageCount - previousMessageCount.value;
      const newMessages = result.messages?.slice(-newMessagesCount) || [];

      // Check if any new message is from user (customer)
      const hasNewUserMessage = newMessages.some((msg) => msg.type === MessageType.CUSTOMER);

      if (hasNewUserMessage) {
        playSound("/sounds/message-received.mp3");
      }
    }
    previousMessageCount.value = currentMessageCount;

    conversation.value = result;

    // Fetch assigned user info if conversation is taken over
    if (result.status === "human-took-over") {
      assignedUser.value = await HayApi.conversations.getAssignedUser.query({ conversationId });
      humanTakeover.value = assignedUser.value?.id === currentUserId.value;
    } else {
      assignedUser.value = null;
      humanTakeover.value = false;
    }
  } catch (error) {
    console.error("Failed to fetch conversation:", error);
    // Show error toast or redirect
  } finally {
    loading.value = false;
  }
};

// Helper function to play sounds
const playSound = (soundPath: string) => {
  try {
    const audio = new Audio(soundPath);
    audio.volume = 0.5;
    audio.play().catch((error) => {
      console.error("Failed to play sound:", error);
    });
  } catch (error) {
    console.error("Error creating audio:", error);
  }
};

// WebSocket setup
const { useWebSocket } = await import("@/composables/useWebSocket");
const websocket = useWebSocket();
let unsubscribeMessageReceived: (() => void) | null = null;
let unsubscribeStatusChanged: (() => void) | null = null;

// Lifecycle
onMounted(async () => {
  // Fetch conversation and messages in parallel
  await Promise.all([fetchConversation()]);

  // Setup WebSocket connection for real-time updates
  websocket.connect();

  // Listen for new messages
  unsubscribeMessageReceived = websocket.on("message_received", async (payload: any) => {
    console.log("[WebSocket] Received message_received event", payload);
    if (payload.conversationId === conversationId) {
      // Skip refresh only if in takeover mode AND the message is from a human agent (our sent message)
      if (isTakenOverByCurrentUser.value && payload.messageType === MessageType.HUMAN_AGENT) {
        console.log("[WebSocket] In takeover mode, skipping refresh for human agent message");
        return;
      }
      console.log("[WebSocket] New message for current conversation, refreshing");
      await fetchConversation();
      scrollToBottom();
    } else {
      console.log(
        `[WebSocket] Message for different conversation (current: ${conversationId}, received: ${payload.conversationId})`,
      );
    }
  });

  // Listen for status changes
  unsubscribeStatusChanged = websocket.on("conversation_status_changed", async (payload: any) => {
    if (payload.conversationId === conversationId) {
      console.log("[WebSocket] Conversation status changed, refreshing");
      await fetchConversation();
    }
  });
});

// eslint-disable-next-line no-undef
onUnmounted(() => {
  // Cleanup WebSocket event handlers
  if (unsubscribeMessageReceived) unsubscribeMessageReceived();
  if (unsubscribeStatusChanged) unsubscribeStatusChanged();
});

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: 'auth',
});

// Head management
useHead({
  title: computed(() => `${conversation.value?.title || "Conversation"} - Hay Dashboard`),
});
</script>
