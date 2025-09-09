<template>
  <div class="h-screen flex flex-col -m-4 md:-m-6">
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
            <p class="text-sm text-muted-foreground">
              Conversation #{{ conversation?.id?.slice(0, 8) }}
            </p>
          </div>
        </div>
        <div class="flex items-center space-x-2">
          <Badge :variant="getStatusVariant(conversation?.status)">
            <component
              :is="getStatusIcon(conversation?.status)"
              class="h-3 w-3 mr-1"
            />
            {{ formatStatus(conversation?.status) }}
          </Badge>
          <Badge
            v-if="
              conversation?.cooldown_until &&
              new Date(conversation.cooldown_until) > new Date()
            "
            variant="destructive"
          >
            <Clock class="h-3 w-3 mr-1" />
            Cooldown {{ formatCountdown(conversation.cooldown_until) }}
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
            v-if="
              conversation?.status === 'open' ||
              conversation?.status === 'pending-human'
            "
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
        <div
          ref="messagesContainer"
          class="flex-1 overflow-y-auto p-6 space-y-4"
        >
          <div v-if="loading" class="space-y-4">
            <div v-for="i in 5" :key="i" class="animate-pulse">
              <div class="flex space-x-3">
                <div class="w-8 h-8 bg-gray-200 rounded-full"></div>
                <div class="flex-1">
                  <div class="h-3 bg-gray-200 rounded w-1/4 mb-2"></div>
                  <div class="h-10 bg-gray-200 rounded w-3/4"></div>
                </div>
              </div>
            </div>
          </div>

          <div
            v-else-if="conversation?.messages?.length === 0"
            class="text-center py-12"
          >
            <MessageSquare
              class="h-12 w-12 text-muted-foreground mx-auto mb-4"
            />
            <p class="text-muted-foreground">
              No messages in this conversation yet
            </p>
          </div>

          <div v-else class="space-y-4">
            <!-- Conversation Start -->
            <div class="text-center">
              <div
                class="inline-flex items-center px-3 py-1 bg-background-tertiary rounded-full text-sm text-muted-foreground"
              >
                <Clock class="h-3 w-3 mr-1" />
                Conversation started {{ formatDate(conversation?.created_at) }}
              </div>
            </div>

            <!-- Messages -->
            <template
              v-for="(message, index) in conversation?.messages"
              :key="message.id"
            >
              <ChatMessage
                :message="message"
                @approve="
                  message.needsApproval ? approveMessage(message.id) : undefined
                "
                @edit="
                  message.needsApproval ? editMessage(message.id) : undefined
                "
                @reject="
                  message.needsApproval ? rejectMessage(message.id) : undefined
                "
              />
            </template>

            <!-- Typing indicator -->
            <div v-if="isTyping" class="flex space-x-3 max-w-2xl">
              <div
                class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center"
              >
                <User class="h-4 w-4 text-primary" />
              </div>
              <div class="flex-1">
                <div class="bg-background-tertiary p-3 rounded-lg">
                  <div class="flex space-x-1">
                    <div
                      class="w-2 h-2 bg-background-tertiary-foreground/50 rounded-full animate-bounce"
                    ></div>
                    <div
                      class="w-2 h-2 bg-background-tertiary-foreground/50 rounded-full animate-bounce"
                      style="animation-delay: 0.1s"
                    ></div>
                    <div
                      class="w-2 h-2 bg-background-tertiary-foreground/50 rounded-full animate-bounce"
                      style="animation-delay: 0.2s"
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Human Takeover Panel -->
        <div v-if="humanTakeover" class="border-t bg-yellow-50 p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <AlertTriangle class="h-4 w-4 text-yellow-600" />
              <span class="text-sm font-medium text-yellow-800"
                >You are now handling this conversation</span
              >
            </div>
            <Button variant="outline" size="sm" @click="endTakeover">
              End Takeover
            </Button>
          </div>
        </div>

        <!-- Message Input (when human takeover is active) -->
        <div v-if="humanTakeover" class="border-t p-4">
          <div class="flex space-x-3">
            <Input
              v-model="newMessage"
              placeholder="Type your message..."
              class="flex-1"
              @keyup.enter="sendMessage"
            />
            <Button :disabled="!newMessage.trim()" @click="sendMessage">
              <Send class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <!-- Right Side: Context Panel -->
      <div class="w-80 border-l bg-background-tertiary">
        <div class="p-6 space-y-6">
          <!-- Customer Information -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base">Customer Information</CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="flex items-center space-x-3">
                <div
                  class="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center"
                >
                  <User class="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div class="font-medium">Customer</div>
                  <div class="text-sm text-muted-foreground">
                    {{ conversation?.id?.slice(0, 8) }}
                  </div>
                </div>
              </div>
              <div class="space-y-2 text-sm">
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Conversation ID:</span>
                  <span class="font-mono text-xs">{{
                    conversation?.id?.slice(0, 8)
                  }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Status:</span>
                  <span>{{ conversation?.status }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Created:</span>
                  <span>{{ formatDate(conversation?.created_at) }}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- Conversation Details -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base">Conversation Details</CardTitle>
            </CardHeader>
            <CardContent class="space-y-3 text-sm">
              <div class="flex justify-between">
                <span class="text-muted-foreground">Agent:</span>
                <span>{{ conversation?.agent?.name || "AI Assistant" }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Status:</span>
                <span>{{ formatStatus(conversation?.status) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Messages:</span>
                <span>{{ conversation?.messages?.length }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Created:</span>
                <span>{{ formatDate(conversation?.created_at) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Updated:</span>
                <span>{{ formatDate(conversation?.updated_at) }}</span>
              </div>
            </CardContent>
          </Card>

          <!-- Previous Conversations -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base">Previous Conversations</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                v-if="previousConversations.length === 0"
                class="text-sm text-muted-foreground"
              >
                No previous conversations
              </div>
              <div v-else class="space-y-3">
                <div
                  v-for="prevConv in previousConversations"
                  :key="prevConv.id"
                  class="p-3 border rounded-md hover:bg-background-secondary cursor-pointer"
                  @click="viewConversation(prevConv.id)"
                >
                  <div class="text-sm font-medium">{{ prevConv.subject }}</div>
                  <div class="text-xs text-muted-foreground">
                    {{ formatDate(prevConv.createdAt) }} • {{ prevConv.status }}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- Available Actions -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base">Quick Actions</CardTitle>
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
              <CardTitle class="text-base">Related Articles</CardTitle>
            </CardHeader>
            <CardContent>
              <div class="space-y-2">
                <div
                  v-for="article in relatedArticles"
                  :key="article.id"
                  class="p-2 border rounded text-sm hover:bg-background-secondary cursor-pointer"
                >
                  <div class="font-medium">{{ article.title }}</div>
                  <div class="text-xs text-muted-foreground">
                    {{ article.category }}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
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
} from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import Badge from "@/components/ui/Badge.vue";

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

// Data from API
const conversation = ref<any>(null);

const previousConversations = ref<any[]>([]);
const relatedArticles = ref<any[]>([]);

const goBack = () => {
  navigateTo("/conversations");
};

const getStatusVariant = (
  status: string
): "default" | "secondary" | "destructive" | "outline" | undefined => {
  const variants: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    open: "default",
    "pending-human": "destructive",
    resolved: "secondary",
    processing: "outline",
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
    "pending-human": "Pending Human",
    resolved: "Resolved",
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

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
};

const toggleSupervisionMode = () => {
  supervisionMode.value = !supervisionMode.value;
  // TODO: Enable/disable supervision mode
  console.log("Supervision mode:", supervisionMode.value);
};

const takeOverConversation = () => {
  humanTakeover.value = true;
  supervisionMode.value = false;
  // TODO: Implement conversation takeover
  console.log("Take over conversation");
};

const endTakeover = () => {
  humanTakeover.value = false;
  // TODO: End conversation takeover
  console.log("End takeover");
};

const sendMessage = async () => {
  if (!newMessage.value.trim()) return;

  try {
    // Send message via API
    const result = await HayApi.conversations.sendMessage.mutate({
      conversationId,
      content: newMessage.value,
      role: "user",
    });

    // Add message to local list
    conversation.value.messages.push({
      id: result.id,
      sender: "customer",
      content: newMessage.value,
      timestamp: new Date(),
      type: "HumanMessage",
    });

    newMessage.value = "";
    scrollToBottom();

    // Refresh messages after a short delay to get any AI response
    setTimeout(() => fetchConversation(), 2000);
  } catch (error) {
    console.error("Failed to send message:", error);
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

// Fetch conversation data
const fetchConversation = async () => {
  try {
    loading.value = true;
    const result = await HayApi.conversations.get.query({ id: conversationId });
    conversation.value = result;
  } catch (error) {
    console.error("Failed to fetch conversation:", error);
    // Show error toast or redirect
  } finally {
    loading.value = false;
  }
};

// Lifecycle
onMounted(async () => {
  // Fetch conversation and messages in parallel
  await Promise.all([fetchConversation()]);

  // TODO: Setup WebSocket connection for real-time updates
});

// eslint-disable-next-line no-undef
onUnmounted(() => {
  // TODO: Cleanup WebSocket connections
});

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: 'auth',
});

// Head management
useHead({
  title: computed(
    () => `${conversation.value?.title || "Conversation"} - Hay Dashboard`
  ),
});
</script>
