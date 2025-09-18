<template>
  <div class="h-screen flex flex-col -m-4 md:-m-6">
    <!-- Header -->
    <div
      class="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <div class="flex items-center justify-between px-6 py-4">
        <div class="flex items-center space-x-4">
          <Button variant="ghost"
@click="exitPlayground">
            <X class="h-4 w-4 mr-2" />
            Exit Playground
          </Button>
          <div>
            <h1 class="text-xl font-semibold">Conversation Playground</h1>
            <p class="text-sm text-muted-foreground">
Test conversations with AI Assistant
</p>
          </div>
        </div>
        <div class="flex items-center space-x-2">
          <!-- Playbook Selector -->
          <div class="flex items-center space-x-2">
            <label class="text-sm font-medium">Playbook:</label>
            <select
              v-model="selectedPlaybookId"
              class="px-3 py-1 text-sm border border-input rounded-md"
              :disabled="!!conversation"
              title="Playbook can only be set when creating a new test"
            >
              <option value="">No playbook (free chat)</option>
              <option v-for="playbook in playbooks" :key="playbook.id" :value="playbook.id">
                {{ playbook.name }}
              </option>
            </select>
          </div>

          <Badge :variant="getStatusVariant(conversation?.status)">
            <component :is="getStatusIcon(conversation?.status)" class="h-3 w-3 mr-1" />
            {{ formatStatus(conversation?.status) }}
          </Badge>

          <Button variant="outline" size="sm" :disabled="isResetting" @click="resetConversation">
            <RefreshCw class="h-4 w-4 mr-2" />
            New Test
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
          <div v-if="messagesLoading"
class="space-y-4">
            <div v-for="i in 3"
:key="i" class="animate-pulse">
              <div class="flex space-x-3">
                <div class="w-8 h-8 bg-gray-200 rounded-full" />
                <div class="flex-1">
                  <div class="h-3 bg-gray-200 rounded w-1/4 mb-2" />
                  <div class="h-10 bg-gray-200 rounded w-3/4" />
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="messages.length === 0"
class="text-center py-12">
            <MessageSquare class="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p class="text-muted-foreground">Send a message to start testing</p>
          </div>

          <div v-else
class="space-y-4">
            <!-- Messages -->
            <ChatMessage
              v-for="(message, index) in messages"
              :key="message.id"
              :message="message"
              :inverted="true"
            />

            <!-- Typing indicator -->
            <div v-if="isAgentTyping"
class="flex space-x-3 max-w-2xl">
              <div class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                <Bot class="h-4 w-4 text-primary" />
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

        <!-- Message Input -->
        <div class="border-t p-4 bg-background">
          <div class="flex space-x-3">
            <Input
              v-model="newMessage"
              placeholder="Type your test message..."
              class="flex-1"
              :disabled="!conversation"
              @keyup.enter="sendMessage"
            />
            <Button :disabled="!newMessage.trim() || !conversation" @click="sendMessage">
              <Send class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <!-- Right Side: Context Panel -->
      <div class="w-80 border-l bg-background-tertiary">
        <div class="p-6 space-y-6">
          <!-- Orchestrator Status -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base flex items-center">
                <Activity class="h-4 w-4 mr-2" />
                Orchestrator Status
              </CardTitle>
            </CardHeader>
            <CardContent class="space-y-3 text-sm">
              <div class="flex justify-between">
                <span class="text-muted-foreground">Status:</span>
                <Badge :variant="orchestratorStatus === 'processing' ? 'default' : 'secondary'">
                  {{ orchestratorStatus }}
                </Badge>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Last Check:</span>
                <span>{{ lastOrchestratorCheck || "Never" }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Messages:</span>
                <span>{{ messages.length }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Needs Processing:</span>
                <span>{{ conversation?.needs_processing }}</span>
              </div>
              <div v-if="conversation?.playbook_id" class="flex justify-between">
                <span class="text-muted-foreground">Active Playbook:</span>
                <span class="font-medium">
                  {{ getPlaybookName(conversation.playbook_id) }}
                </span>
              </div>
            </CardContent>
          </Card>

          <!-- Quick Actions -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base"> Test Scenarios </CardTitle>
            </CardHeader>
            <CardContent class="space-y-2">
              <Button
                variant="outline"
                size="sm"
                class="w-full justify-start"
                @click="sendQuickMessage('What are your business hours?')"
              >
                <Clock class="h-4 w-4 mr-2" />
                Ask About Hours
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="w-full justify-start"
                @click="sendQuickMessage('I need help with my account')"
              >
                <HelpCircle class="h-4 w-4 mr-2" />
                Request Support
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="w-full justify-start"
                @click="sendQuickMessage('I want to cancel my subscription')"
              >
                <DollarSign class="h-4 w-4 mr-2" />
                Cancel Subscription
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="w-full justify-start"
                @click="sendQuickMessage('I want to speak to a human')"
              >
                <UserCheck class="h-4 w-4 mr-2" />
                Request Human
              </Button>
            </CardContent>
          </Card>

          <!-- Tips -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base"> Testing Tips </CardTitle>
            </CardHeader>
            <CardContent>
              <ul class="text-sm space-y-2 text-muted-foreground">
                <li class="flex items-start">
                  <Info class="h-3 w-3 mr-2 mt-0.5 flex-shrink-0" />
                  <span>Test different message types to see AI responses</span>
                </li>
                <li class="flex items-start">
                  <Info class="h-3 w-3 mr-2 mt-0.5 flex-shrink-0" />
                  <span>Try switching playbooks to test different scenarios</span>
                </li>
                <li class="flex items-start">
                  <Info class="h-3 w-3 mr-2 mt-0.5 flex-shrink-0" />
                  <span>Use "New Test" to start fresh with a new conversation</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  X,
  RefreshCw,
  MessageSquare,
  Send,
  Bot,
  FlaskConical,
  Activity,
  Clock,
  HelpCircle,
  DollarSign,
  UserCheck,
  Info,
  Circle,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import Badge from "@/components/ui/Badge.vue";

// Reactive state
const messagesLoading = ref(false);
const isAgentTyping = ref(false);
const isSending = ref(false);
const isResetting = ref(false);
const newMessage = ref("");
const messagesContainer = ref<HTMLElement>();
const selectedPlaybookId = ref("");

// Data
const conversation = ref<any>(null);
const messages = ref<any[]>([]);
const playbooks = ref<any[]>([]);

// Orchestrator status
const orchestratorStatus = ref("idle");
const lastOrchestratorCheck = ref("");
const processingCount = ref(0);

// Polling
let pollingInterval: NodeJS.Timeout | null = null;

// Navigation
const router = useRouter();

// Methods
const shouldShowHeader = (index: number): boolean => {
  // Always show header for first message
  if (index === 0) return true;

  // Check if previous message has same sender type
  const currentMessage = messages.value[index];
  const previousMessage = messages.value[index - 1];

  return currentMessage.sender !== previousMessage.sender;
};

const exitPlayground = () => {
  stopPolling();
  router.push("/conversations");
};

// Status helpers
const getStatusVariant = (
  status: string,
): "default" | "secondary" | "destructive" | "outline" | undefined => {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    open: "default",
    processing: "outline",
    "pending-human": "destructive",
    resolved: "secondary",
    closed: "secondary",
  };
  return variants[status] || "default";
};

const getStatusIcon = (status: string) => {
  const icons = {
    open: Circle,
    processing: Activity,
    "pending-human": AlertTriangle,
    resolved: CheckCircle,
    closed: XCircle,
  };
  return icons[status as keyof typeof icons] || Circle;
};

const formatStatus = (status: string) => {
  const labels = {
    open: "Open",
    processing: "Processing",
    "pending-human": "Needs Human",
    resolved: "Resolved",
    closed: "Closed",
  };
  return labels[status as keyof typeof labels] || status;
};

const formatDate = (date: Date | string | undefined) => {
  if (!date) return "N/A";
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(dateObj);
};

const getPlaybookName = (id: string) => {
  const playbook = playbooks.value.find((p) => p.id === id);
  return playbook?.name || "Unknown";
};

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
};

// Create initial conversation
const createTestConversation = async () => {
  try {
    messagesLoading.value = true;

    const response = await HayApi.conversations.create.mutate({
      title: "Playground Test - " + new Date().toLocaleTimeString(),
      metadata: {
        source: "playground",
        test_mode: true,
      },
      playbook_id: selectedPlaybookId.value || undefined,
      status: "open",
    });

    conversation.value = response;
    messages.value = [];

    // Start polling for updates
    startPolling();
  } catch (error) {
    console.error("Failed to create test conversation:", error);
  } finally {
    messagesLoading.value = false;
  }
};

// Send message
const sendMessage = async () => {
  if (!newMessage.value.trim() || !conversation.value) return;

  const message = newMessage.value;
  newMessage.value = "";

  // Generate a unique ID for the temp message
  const tempMessageId = Date.now().toString();

  try {
    isSending.value = true;
    isAgentTyping.value = true;

    // Add message to UI immediately
    const tempMessage = {
      id: tempMessageId,
      sender: "customer",
      content: message,
      timestamp: new Date(),
      type: "HumanMessage",
    };
    messages.value.push(tempMessage);
    scrollToBottom();

    // Send to API
    const result = await HayApi.conversations.sendMessage.mutate({
      conversationId: conversation.value.id,
      content: message,
      role: "user",
    });

    // Update with actual message from server
    const messageIndex = messages.value.findIndex((m) => m.id === tempMessageId);
    if (messageIndex !== -1) {
      messages.value[messageIndex] = {
        ...result,
        sender: "customer",
        timestamp: result.created_at,
      };
    }

    // Update orchestrator status
    orchestratorStatus.value = "processing";
    processingCount.value++;
  } catch (error) {
    console.error("Failed to send message:", error);
    // Remove temp message on error
    messages.value = messages.value.filter((m) => m.id !== tempMessageId);
  } finally {
    isSending.value = false;
  }
};

// Quick message helpers
const sendQuickMessage = async (message: string) => {
  newMessage.value = message;
  await sendMessage();
};

// Note: Playbook can only be set during conversation creation
// To test a different playbook, use the "New Test" button

// Reset conversation
const resetConversation = async () => {
  try {
    isResetting.value = true;
    stopPolling();

    // Close current conversation if exists
    if (conversation.value) {
      await HayApi.conversations.update.mutate({
        id: conversation.value.id,
        data: { status: "closed" },
      });
    }

    // Create new conversation
    await createTestConversation();
  } catch (error) {
    console.error("Failed to reset conversation:", error);
  } finally {
    isResetting.value = false;
  }
};

// Load playbooks
const loadPlaybooks = async () => {
  try {
    const response = await HayApi.playbooks.list.query();
    playbooks.value = Array.isArray(response) ? response : (response as any)?.items || [];
  } catch (error) {
    console.error("Failed to load playbooks:", error);
  }
};

// Poll for updates
const pollConversation = async () => {
  if (!conversation.value) return;

  try {
    const response = await HayApi.conversations.get.query({
      id: conversation.value.id,
    });

    // Update conversation status
    conversation.value = response;

    // Check for new messages
    const allMessages = response.messages || [];

    // Transform messages to match the component format
    const transformedMessages = allMessages.map((msg: any) => {
      let sender = "system";
      if (msg.type === "AIMessage" || msg.type === "AI_MESSAGE") {
        sender = "agent";
      } else if (msg.type === "HumanMessage" || msg.type === "HUMAN_MESSAGE") {
        sender = "customer";
      } else if (msg.sender) {
        sender =
          msg.sender === "assistant" ? "agent" : msg.sender === "user" ? "customer" : msg.sender;
      }

      return {
        id: msg.id,
        content: msg.content,
        timestamp: msg.created_at,
        type: msg.type,
        sender,
      };
    });

    // Check if we have new messages
    if (transformedMessages.length > messages.value.length) {
      messages.value = transformedMessages;
      isAgentTyping.value = false;
      scrollToBottom();
    }

    // Update orchestrator status
    lastOrchestratorCheck.value = new Date().toLocaleTimeString();
    if (response.status === "processing") {
      orchestratorStatus.value = "processing";
    } else {
      orchestratorStatus.value = "idle";
    }
  } catch (error) {
    console.error("Failed to poll conversation:", error);
  }
};

const startPolling = () => {
  stopPolling();
  pollingInterval = setInterval(pollConversation, 1000);
};

const stopPolling = () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
};

// Lifecycle
onMounted(async () => {
  await loadPlaybooks();
  await createTestConversation();
});

onUnmounted(() => {
  stopPolling();

  // Close test conversation
  if (conversation.value) {
    HayApi.conversations.update
      .mutate({
        id: conversation.value.id,
        data: { status: "closed" },
      })
      .catch(console.error);
  }
});

// Page meta
definePageMeta({
  layout: "default",
});

// Head
useHead({
  title: "Conversation Playground - Hay Dashboard",
});
</script>
