<template>
  <div class="h-screen flex flex-col">
    <!-- Header -->
    <div
      class="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <div class="flex items-center justify-between px-6 py-4">
        <!-- Playground Mode Header -->
        <template v-if="isPlaygroundMode">
          <div class="flex items-center space-x-4">
            <Button variant="ghost" @click="exitPlayground">
              <X class="h-4 w-4 mr-2" />
              Exit Playground
            </Button>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="text-xl font-semibold">Conversation Playground</h1>
                <Badge variant="outline" class="text-xs">
                  <Info class="h-3 w-3 mr-1" />
                  Auto-sends
                </Badge>
              </div>
              <p class="text-sm text-neutral-muted">
                Test conversations with AI • Messages auto-send • Use
                <ThumbsUp class="icon" />/<ThumbsDown class="icon" /> to rate quality
              </p>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <Button variant="outline" size="sm" :disabled="isResetting" @click="resetConversation">
              <RefreshCw class="h-4 w-4 mr-2" />
              New Test
            </Button>
          </div>
        </template>

        <!-- Regular Conversation Header -->
        <template v-else>
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
        </template>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left Side: Conversation Thread -->
      <div class="flex-1 flex flex-col">
        <!-- Messages Container -->
        <div ref="messagesContainer" class="flex-1 overflow-y-auto p-6 space-y-4">
          <!-- Playground Loading State -->
          <div v-if="isPlaygroundMode && messagesLoading" class="space-y-4">
            <div v-for="i in 3" :key="i" class="animate-pulse">
              <div class="flex space-x-3">
                <div class="w-8 h-8 bg-gray-200 rounded-full" />
                <div class="flex-1">
                  <div class="h-3 bg-gray-200 rounded w-1/4 mb-2" />
                  <div class="h-10 bg-gray-200 rounded w-3/4" />
                </div>
              </div>
            </div>
          </div>

          <!-- Playground Empty State -->
          <div v-else-if="isPlaygroundMode && messages.length === 0" class="text-center py-12">
            <MessageSquare class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
            <p class="text-neutral-muted">Send a message to start testing</p>
          </div>

          <!-- Playground Messages -->
          <TransitionGroup
            v-else-if="isPlaygroundMode"
            name="message"
            tag="div"
            class="space-y-4"
            enter-active-class="transition ease-out duration-200"
            enter-from-class="opacity-0 translate-y-1"
            enter-to-class="opacity-100 translate-y-0"
          >
            <ChatMessage
              v-for="message in messages"
              :key="message.id"
              :message="message"
              :inverted="true"
              :show-feedback="true"
              @retry="retryMessage"
            />
          </TransitionGroup>

          <!-- Agent Typing indicator (outside TransitionGroup) -->
          <div v-if="isPlaygroundMode">
            <div v-if="isAgentTyping" class="flex space-x-3 max-w-2xl">
              <div class="w-8 h-8"></div>
              <div class="max-w-sm">
                <div class="bg-background-tertiary p-3 rounded-lg">
                  <div class="flex space-x-1">
                    <div class="w-1 h-1 bg-neutral-700 rounded-full animate-bounce" />
                    <div
                      class="w-1 h-1 bg-neutral-700 rounded-full animate-bounce"
                      style="animation-delay: 0.1s"
                    />
                    <div
                      class="w-1 h-1 bg-neutral-700 rounded-full animate-bounce"
                      style="animation-delay: 0.2s"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Regular Conversation Loading State -->
          <div v-else-if="loading" class="space-y-4">
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

          <!-- Regular Conversation Empty State -->
          <div v-else-if="conversation?.messages?.length === 0" class="text-center py-12">
            <MessageSquare class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
            <p class="text-neutral-muted">No messages in this conversation yet</p>
          </div>

          <!-- Regular Conversation Messages -->
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
              name="message"
              enter-active-class="transition ease-out duration-200"
              enter-from-class="opacity-0 translate-y-1"
              enter-to-class="opacity-100 translate-y-0"
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
                @retry="retryMessage"
              />
            </TransitionGroup>

            <!-- Typing indicator -->
            <div v-if="isTyping" class="flex space-x-3 max-w-2xl">
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
              <Button variant="outline" size="sm" @click="endTakeover">
                Release Conversation
              </Button>
              <Button variant="outline" size="sm" @click="showCloseDialog = true">
                Close Conversation
              </Button>
            </div>
          </div>
        </div>

        <!-- Pending Human Panel (Playground Mode) -->
        <div v-if="isPlaygroundMode && isPendingHuman" class="border-t bg-amber-50 p-4">
          <div class="space-y-4">
            <div class="flex items-start space-x-3">
              <AlertCircle class="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div class="flex-1">
                <p class="text-sm font-medium text-amber-900">
                  Hay wasn't confident about answering this question
                </p>
                <p class="text-sm text-amber-700 mt-1">
                  Hay decided to hand this conversation to a human agent. Providing more context in
                  the playbooks can be a good place to start to provide more information so Hay can
                  handle similar conversations next time.
                </p>
              </div>
            </div>
            <div class="flex items-center space-x-2">
              <Button variant="outline" size="sm" @click="resetConversation">
                <RefreshCw class="h-4 w-4 mr-2" />
                Start New Conversation
              </Button>
              <Button
                v-if="conversation?.playbook_id"
                variant="outline"
                size="sm"
                @click="navigateToPlaybook"
              >
                <BookOpen class="h-4 w-4 mr-2" />
                Edit Playbook
              </Button>
              <Button v-else variant="outline" size="sm" @click="navigateToPlaybook">
                <BookOpen class="h-4 w-4 mr-2" />
                Edit Playbooks
              </Button>
            </div>
          </div>
        </div>

        <!-- Message Input (playground mode or when conversation is taken over by current user) -->
        <div
          v-if="(isPlaygroundMode && !isPendingHuman) || isTakenOverByCurrentUser"
          class="border-t p-4 bg-background"
        >
          <form @submit.prevent="sendMessage" class="flex space-x-3">
            <Input
              v-model="newMessage"
              :placeholder="isPlaygroundMode ? 'Type your test message...' : 'Type your message...'"
              class="flex-1"
              :disabled="isPlaygroundMode && !conversation"
              @keyup.enter="sendMessage"
            />
            <Button
              type="submit"
              :disabled="
                !newMessage.trim() || isSendingMessage || (isPlaygroundMode && !conversation)
              "
            >
              <Send class="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>

      <!-- Right Side: Context Panel -->
      <div class="w-80 border-l bg-background-tertiary">
        <div class="p-6 space-y-6">
          <!-- Playground Mode Panels -->
          <template v-if="isPlaygroundMode">
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
                  <span class="text-neutral-muted">Status:</span>
                  <Badge :variant="orchestratorStatus === 'processing' ? 'default' : 'secondary'">
                    {{ orchestratorStatus }}
                  </Badge>
                </div>
                <div class="flex justify-between">
                  <span class="text-neutral-muted">Last Check:</span>
                  <span>{{ lastOrchestratorCheck || "Never" }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-neutral-muted">Messages:</span>
                  <span>{{ messages.length }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-neutral-muted">Needs Processing:</span>
                  <span>{{ conversation?.needs_processing }}</span>
                </div>
              </CardContent>
            </Card>

            <!-- Test Scenarios -->
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

            <!-- Testing Tips -->
            <Card>
              <CardHeader>
                <CardTitle class="text-base"> Testing Tips </CardTitle>
              </CardHeader>
              <CardContent>
                <ul class="text-sm space-y-2 text-neutral-muted">
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
          </template>

          <!-- Regular Conversation Panels -->
          <template v-else>
            <!-- Customer Information -->
            <Card>
              <CardHeader>
                <CardTitle class="text-base"> Customer Information </CardTitle>
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
          </template>
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
  AlertCircle,
  Star,
  Ticket,
  Mail,
  Phone,
  Circle,
  CheckCircle,
  XCircle,
  User,
  ShieldAlert,
  X,
  RefreshCw,
  Bot,
  Activity,
  HelpCircle,
  DollarSign,
  Info,
  ThumbsUp,
  ThumbsDown,
  BookOpen,
} from "lucide-vue-next";
import { HayApi } from "@/utils/api";

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
const routeId = route.params["id"] as string;

// Detect playground mode (similar to playbooks detecting "new")
const isPlaygroundMode = computed(() => routeId === "playground");

// Conversation ID - will be set after creating playground conversation
const conversationId = ref<string>(routeId);

// Reactive state
const loading = ref(true);
const supervisionMode = ref(false);
const humanTakeover = ref(false);
const isTyping = ref(false);
const newMessage = ref("");
const messagesContainer = ref<HTMLElement>();

// Playground-specific state
const isResetting = ref(false);
const messagesLoading = ref(false);
const isAgentTyping = ref(false);
const orchestratorStatus = ref("idle");
const lastOrchestratorCheck = ref("");
const processingCount = ref(0);
const messages = ref<any[]>([]);

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
  const organization = conversation.value?.organization;

  if (!agent) return false;

  // Check agent's testMode setting
  // If agent has explicit setting, use it; otherwise check org default
  const orgDefault = organization?.settings?.testModeDefault ?? false;
  return agent.testMode ?? orgDefault;
});

// Check if conversation status is pending-human (needs human attention)
const isPendingHuman = computed(() => {
  return conversation.value?.status === "pending-human";
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

// Playground-specific functions
const exitPlayground = () => {
  navigateTo("/conversations");
};

const navigateToPlaybook = () => {
  const router = useRouter();
  if (conversation.value?.playbook_id) {
    router.push(`/playbooks/${conversation.value.playbook_id}`);
  } else {
    router.push("/playbooks");
  }
};

const createTestConversation = async () => {
  try {
    messagesLoading.value = true;

    const response = await HayApi.conversations.create.mutate({
      metadata: {
        sourceId: "playground",
        test_mode: true,
      },
      status: "open",
    });

    conversation.value = response;
    conversationId.value = response.id;
    messages.value = [];
  } catch (error) {
    console.error("Failed to create test conversation:", error);
  } finally {
    messagesLoading.value = false;
  }
};

const resetConversation = async () => {
  try {
    isResetting.value = true;

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

const sendQuickMessage = async (message: string) => {
  newMessage.value = message;
  await sendMessage();
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
      conversationId: conversationId.value,
    });
    humanTakeover.value = true;
    supervisionMode.value = false;
    toast.success("Conversation taken over", "You are now handling this conversation");
    // Refresh conversation and assigned user
    await fetchConversation();
    assignedUser.value = await HayApi.conversations.getAssignedUser.query({
      conversationId: conversationId.value,
    });
  } catch (error: any) {
    console.error("Failed to take over conversation:", error);
    const errorMessage =
      error?.message || error?.data?.message || "Failed to take over conversation";
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
      conversationId: conversationId.value,
      returnToMode: releaseMode.value,
    });
    humanTakeover.value = false;
    assignedUser.value = null;
    showReleaseDialog.value = false;
    const message =
      releaseMode.value === "ai" ? "Conversation returned to AI" : "Conversation returned to queue";
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
      conversationId: conversationId.value,
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

  // Generate temporary ID for optimistic message
  const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const role = isTakenOverByCurrentUser.value ? "assistant" : "user";
  const messageType = isTakenOverByCurrentUser.value
    ? MessageType.HUMAN_AGENT
    : MessageType.CUSTOMER;

  // Create optimistic message
  const optimisticMessage: any = {
    id: tempId,
    content: messageContent,
    type: messageType,
    sender: role === "assistant" ? "agent" : "customer",
    created_at: new Date().toISOString(),
    conversation_id: conversationId.value,
    updated_at: new Date().toISOString(),
    status: "approved",
    deliveryState: "pending",
  };

  // Add optimistic message to the appropriate list
  if (isPlaygroundMode.value) {
    messages.value.push(optimisticMessage);
  } else if (conversation.value && conversation.value.messages) {
    conversation.value.messages.push(optimisticMessage);
  }

  scrollToBottom();

  try {
    // Send message via API
    const result = await HayApi.conversations.sendMessage.mutate({
      conversationId: conversationId.value,
      content: messageContent,
      role,
    });

    // Play message sent sound
    playSound("/sounds/message-sent.mp3");

    // Update optimistic message with real ID and mark as sent
    const messagesList = isPlaygroundMode.value ? messages.value : conversation.value?.messages;
    if (messagesList) {
      const messageIndex = messagesList.findIndex((m: any) => m.id === tempId);
      if (messageIndex !== -1) {
        // Update the message with real ID and mark as sent
        messagesList[messageIndex] = {
          ...messagesList[messageIndex],
          id: result.id,
          deliveryState: "sent",
        };
      }
    }

    // Playground mode: Update orchestrator status for AI response
    if (isPlaygroundMode.value) {
      isAgentTyping.value = true;
      orchestratorStatus.value = "processing";
      processingCount.value++;
    }

    // Regular mode: Refresh messages after a short delay to get any AI response (skip if taken over)
    if (!isPlaygroundMode.value && !isTakenOverByCurrentUser.value) {
      setTimeout(() => fetchConversation(), 2000);
    }
  } catch (error: any) {
    console.error("Failed to send message:", error);

    // Mark optimistic message as failed
    const messagesList = isPlaygroundMode.value ? messages.value : conversation.value?.messages;
    if (messagesList) {
      const messageIndex = messagesList.findIndex((m: any) => m.id === tempId);
      if (messageIndex !== -1) {
        messagesList[messageIndex] = {
          ...messagesList[messageIndex],
          deliveryState: "failed",
          errorMessage: error?.message || error?.data?.message || "Failed to send message",
        };
      }
    }

    // Clear typing state on error
    if (isPlaygroundMode.value) {
      isAgentTyping.value = false;
    }
  } finally {
    isSendingMessage.value = false;
  }
};

const retryMessage = async (messageId: string) => {
  // Find the failed message
  const messagesList = isPlaygroundMode.value ? messages.value : conversation.value?.messages;
  if (!messagesList) return;

  const messageIndex = messagesList.findIndex((m: any) => m.id === messageId);
  if (messageIndex === -1) return;

  const failedMessage = messagesList[messageIndex];
  const messageContent = failedMessage.content;

  // Remove the failed message
  messagesList.splice(messageIndex, 1);

  // Resend by setting the newMessage and calling sendMessage
  newMessage.value = messageContent;
  await sendMessage();
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
  // Skip if in playground mode and no conversation ID yet
  if (isPlaygroundMode.value && !conversationId.value) return;

  try {
    // Only show loading skeleton on initial load
    if (!conversation.value) {
      loading.value = true;
    }
    const result = await HayApi.conversations.get.query({ id: conversationId.value });

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

    // Playground mode: Transform messages for display
    if (isPlaygroundMode.value) {
      const allMessages = result.messages || [];

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
          created_at: msg.created_at,
          type: msg.type,
          sender,
          metadata: msg.metadata,
          attachments: msg.attachments,
          status: msg.status,
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
      orchestratorStatus.value = result.status;
    } else {
      // Fetch assigned user info if conversation is taken over
      if (result.status === "human-took-over") {
        assignedUser.value = await HayApi.conversations.getAssignedUser.query({
          conversationId: conversationId.value,
        });
        humanTakeover.value = assignedUser.value?.id === currentUserId.value;
      } else {
        assignedUser.value = null;
        humanTakeover.value = false;
      }
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
let unsubscribeMessage: (() => void) | null = null;
let unsubscribeStatusChanged: (() => void) | null = null;
let unsubscribeMessageApproved: (() => void) | null = null;
let unsubscribeMessageBlocked: (() => void) | null = null;

// Lifecycle
onMounted(async () => {
  // Playground mode: Create test conversation first
  if (isPlaygroundMode.value) {
    await createTestConversation();
  } else {
    // Regular mode: Fetch conversation
    await Promise.all([fetchConversation()]);
  }

  // Setup WebSocket connection for real-time updates
  websocket.connect();

  // Subscribe to this specific conversation to receive its messages
  console.log("[WebSocket] Subscribing to conversation:", conversationId.value);
  websocket.send({
    type: "subscribe",
    conversationId: conversationId.value,
  });

  // Listen for new messages (full message data)
  unsubscribeMessage = websocket.on("message", async (payload: any) => {
    console.log("[WebSocket] Received message event with full data", payload);
    if (payload.data) {
      const messageData = payload.data;

      // Check if this message belongs to the current conversation
      // In playground mode, check messages array, in regular mode check conversation
      if (isPlaygroundMode.value) {
        // First, try to find and replace optimistic message (pending message with matching content)
        const optimisticIndex = messages.value.findIndex(
          (m: any) =>
            m.deliveryState === "pending" &&
            m.content === messageData.content &&
            m.type === messageData.type,
        );

        if (optimisticIndex !== -1) {
          // Replace optimistic message with real one
          console.log(
            "[WebSocket] Replacing optimistic message with real message:",
            messageData.id,
          );
          messages.value[optimisticIndex] = {
            id: messageData.id,
            content: messageData.content,
            type: messageData.type,
            sender: messageData.type === MessageType.CUSTOMER ? "customer" : "agent",
            timestamp: messageData.timestamp,
            created_at: messageData.timestamp,
            metadata: messageData.metadata,
            status: messageData.status,
            deliveryState: "sent",
          };
          return;
        }

        // Check if message already exists - if so, update it (for tool call responses)
        const existingMessageIndex = messages.value.findIndex((m: any) => m.id === messageData.id);
        if (existingMessageIndex !== -1) {
          console.log("[WebSocket] Updating existing message:", messageData.id);
          messages.value[existingMessageIndex] = {
            id: messageData.id,
            content: messageData.content,
            type: messageData.type,
            sender: messageData.type === MessageType.CUSTOMER ? "customer" : "agent",
            timestamp: messageData.timestamp,
            created_at: messageData.timestamp,
            metadata: messageData.metadata,
            status: messageData.status,
            deliveryState: "sent",
          };
          return;
        }

        // Add new message to playground messages
        messages.value.push({
          id: messageData.id,
          content: messageData.content,
          type: messageData.type,
          sender: messageData.type === MessageType.CUSTOMER ? "customer" : "agent",
          timestamp: messageData.timestamp,
          created_at: messageData.timestamp,
          metadata: messageData.metadata,
          status: messageData.status,
          deliveryState: "sent",
        });

        // Clear typing indicator when bot message is received
        if (messageData.type === MessageType.BOT_AGENT) {
          isAgentTyping.value = false;
        }

        scrollToBottom();
      } else if (conversation.value && conversation.value.messages) {
        // First, try to find and replace optimistic message (pending message with matching content)
        const optimisticIndex = conversation.value.messages.findIndex(
          (m: any) =>
            m.deliveryState === "pending" &&
            m.content === messageData.content &&
            m.type === messageData.type,
        );

        if (optimisticIndex !== -1) {
          // Replace optimistic message with real one
          console.log(
            "[WebSocket] Replacing optimistic message with real message:",
            messageData.id,
          );
          conversation.value.messages[optimisticIndex] = {
            id: messageData.id,
            content: messageData.content,
            type: messageData.type,
            created_at: messageData.timestamp,
            conversation_id: conversationId.value,
            updated_at: messageData.timestamp,
            status: messageData.status || "approved",
            metadata: messageData.metadata,
            deliveryState: "sent",
          };
          return;
        }

        // Check if message already exists - if so, update it (for tool call responses)
        const existingMessageIndex = conversation.value.messages.findIndex((m: any) => m.id === messageData.id);
        if (existingMessageIndex !== -1) {
          console.log("[WebSocket] Updating existing message:", messageData.id);
          conversation.value.messages[existingMessageIndex] = {
            id: messageData.id,
            content: messageData.content,
            type: messageData.type,
            created_at: messageData.timestamp,
            conversation_id: conversationId.value,
            updated_at: messageData.timestamp,
            status: messageData.status || "approved",
            metadata: messageData.metadata,
            deliveryState: "sent",
          };
          return;
        }

        // Add new message to regular conversation
        conversation.value.messages.push({
          id: messageData.id,
          content: messageData.content,
          type: messageData.type,
          created_at: messageData.timestamp,
          conversation_id: conversationId.value,
          updated_at: messageData.timestamp,
          status: messageData.status || "approved",
          metadata: messageData.metadata,
          deliveryState: "sent",
        });

        // Clear typing indicator when bot message is received
        if (messageData.type === MessageType.BOT_AGENT) {
          isTyping.value = false;
        }

        scrollToBottom();

        // Play sound for customer messages
        if (messageData.type === MessageType.CUSTOMER) {
          playSound("/sounds/message-received.mp3");
        }
      }
    }
  });

  // Debounce timer for conversation refreshes to prevent excessive API calls
  let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedRefreshConversation = async (reason: string) => {
    console.log(`[WebSocket] Conversation refresh requested (${reason}), debouncing...`);

    // Clear any pending refresh
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer);
    }

    // Schedule new refresh after 300ms
    refreshDebounceTimer = setTimeout(async () => {
      console.log(`[WebSocket] Executing debounced refresh (${reason})`);
      await fetchConversation();
      refreshDebounceTimer = null;
    }, 300);
  };

  // Listen for status changes
  unsubscribeStatusChanged = websocket.on("conversation_status_changed", async (payload: any) => {
    if (payload.conversationId === conversationId.value) {
      console.log("[WebSocket] Conversation status changed", payload);

      // Handle processing phase for typing indicator
      if (payload.processingPhase) {
        const isProcessing = payload.processingPhase !== "idle";

        if (isPlaygroundMode.value) {
          isAgentTyping.value = isProcessing;
        } else {
          isTyping.value = isProcessing;
        }

        console.log(
          `[WebSocket] Processing phase: ${payload.processingPhase}, typing: ${isProcessing}`,
        );
      }

      await debouncedRefreshConversation("status_changed");
    }
  });

  // Listen for message approval events
  unsubscribeMessageApproved = websocket.on("message_approved", async (payload: any) => {
    console.log("[WebSocket] Received message_approved event", payload);
    if (payload.conversationId === conversationId.value) {
      console.log("[WebSocket] Message approved in current conversation");
      await debouncedRefreshConversation("message_approved");
      // Scroll will happen after refresh completes
      setTimeout(() => scrollToBottom(), 350);
    }
  });

  // Listen for message block events
  unsubscribeMessageBlocked = websocket.on("message_blocked", async (payload: any) => {
    console.log("[WebSocket] Received message_blocked event", payload);
    if (payload.conversationId === conversationId.value) {
      console.log("[WebSocket] Message blocked in current conversation");
      await debouncedRefreshConversation("message_blocked");
    }
  });
});

// eslint-disable-next-line no-undef
onUnmounted(() => {
  // Cleanup WebSocket event handlers
  if (unsubscribeMessage) unsubscribeMessage();
  if (unsubscribeStatusChanged) unsubscribeStatusChanged();
  if (unsubscribeMessageApproved) unsubscribeMessageApproved();
  if (unsubscribeMessageBlocked) unsubscribeMessageBlocked();

  // Close test conversation in playground mode
  if (isPlaygroundMode.value && conversation.value) {
    HayApi.conversations.update
      .mutate({
        id: conversation.value.id,
        data: { status: "closed" },
      })
      .catch(console.error);
  }
});

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: 'auth',
});

// Head management
useHead({
  title: computed(() => `${conversation.value?.title || "New Conversation"} - Hay Dashboard`),
});
</script>
