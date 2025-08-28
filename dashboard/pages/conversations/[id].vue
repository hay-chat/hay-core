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
              {{ conversation?.customer.name || "Loading..." }}
            </h1>
            <p class="text-sm text-muted-foreground">
              {{ conversation?.customer.email }}
            </p>
          </div>
        </div>
        <div class="flex items-center space-x-2">
          <Badge :variant="getStatusVariant(conversation?.status)">
            <component
              :is="getStatusIcon(conversation?.status)"
              class="h-3 w-3 mr-1"
            />
            {{ conversation?.status }}
          </Badge>
          <Button variant="outline" size="sm" @click="exportConversation">
            <Download class="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button
            v-if="conversation?.status === 'active'"
            variant="outline"
            size="sm"
            :class="supervisionMode ? 'bg-orange-50 border-orange-200' : ''"
            @click="toggleSupervisionMode"
          >
            <Eye class="h-4 w-4 mr-2" />
            {{ supervisionMode ? "Exit Supervision" : "Supervise" }}
          </Button>
          <Button
            v-if="conversation?.status === 'active'"
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

          <div v-else-if="messages.length === 0" class="text-center py-12">
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
                class="inline-flex items-center px-3 py-1 bg-muted rounded-full text-sm text-muted-foreground"
              >
                <Clock class="h-3 w-3 mr-1" />
                Conversation started {{ formatDate(conversation?.createdAt) }}
              </div>
            </div>

            <!-- Messages -->
            <div
              v-for="message in messages"
              :key="message.id"
              :class="[
                'flex space-x-3',
                message.sender === 'customer' ? 'justify-start' : 'justify-end',
              ]"
            >
              <!-- Customer Message -->
              <div
                v-if="message.sender === 'customer'"
                class="flex space-x-3 max-w-2xl"
              >
                <div
                  class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center"
                >
                  <User class="h-4 w-4 text-primary" />
                </div>
                <div class="flex-1">
                  <div class="flex items-center space-x-2 mb-1">
                    <span class="text-sm font-medium">{{
                      conversation?.customer.name
                    }}</span>
                    <span class="text-xs text-muted-foreground">{{
                      formatTime(message.timestamp)
                    }}</span>
                  </div>
                  <div class="bg-muted p-3 rounded-lg">
                    <p class="text-sm">{{ message.content }}</p>
                    <div
                      v-if="'attachments' in message && (message as any).attachments?.length"
                      class="mt-2 space-y-1"
                    >
                      <div
                        v-for="attachment in ('attachments' in message ? (message as any).attachments : [])"
                        :key="attachment.id"
                        class="flex items-center space-x-2 text-xs text-muted-foreground"
                      >
                        <Paperclip class="h-3 w-3" />
                        <span>{{ attachment.name }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Agent Message -->
              <div v-else class="flex space-x-3 max-w-2xl justify-end">
                <div class="flex-1 text-right">
                  <div class="flex items-center justify-end space-x-2 mb-1">
                    <span class="text-xs text-muted-foreground">{{
                      formatTime(message.timestamp)
                    }}</span>
                    <span class="text-sm font-medium">{{
                      message.agentName || "Agent"
                    }}</span>
                    <div
                      v-if="message.isPlaybook"
                      class="flex items-center space-x-1"
                    >
                      <Badge variant="outline" class="text-xs">
                        <Zap class="h-2 w-2 mr-1" />
                        Playbook
                      </Badge>
                    </div>
                  </div>
                  <div
                    :class="[
                      'p-3 rounded-lg inline-block text-left',
                      supervisionMode && message.needsApproval
                        ? 'bg-orange-50 border border-orange-200'
                        : 'bg-primary text-primary-foreground',
                    ]"
                  >
                    <p class="text-sm">{{ message.content }}</p>
                    <div
                      v-if="supervisionMode && message.needsApproval"
                      class="mt-3 flex space-x-2"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        @click="approveMessage(message.id)"
                      >
                        <Check class="h-3 w-3 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        @click="editMessage(message.id)"
                      >
                        <Edit class="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        @click="rejectMessage(message.id)"
                      >
                        <X class="h-3 w-3 mr-1" />
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
                <div
                  class="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center"
                >
                  <Bot class="h-4 w-4 text-blue-600" />
                </div>
              </div>

              <!-- System Message -->
              <div
                v-if="message.type === 'system'"
                class="flex justify-center w-full"
              >
                <div
                  class="inline-flex items-center px-3 py-1 bg-muted rounded-full text-sm text-muted-foreground"
                >
                  <component
                    :is="getSystemMessageIcon((message as any).action)"
                    class="h-3 w-3 mr-1"
                  />
                  {{ message.content }}
                </div>
              </div>
            </div>

            <!-- Typing indicator -->
            <div v-if="isTyping" class="flex space-x-3 max-w-2xl">
              <div
                class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center"
              >
                <User class="h-4 w-4 text-primary" />
              </div>
              <div class="flex-1">
                <div class="bg-muted p-3 rounded-lg">
                  <div class="flex space-x-1">
                    <div
                      class="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
                    ></div>
                    <div
                      class="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
                      style="animation-delay: 0.1s"
                    ></div>
                    <div
                      class="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
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
      <div class="w-80 border-l bg-muted/30">
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
                  <div class="font-medium">
                    {{ conversation?.customer.name }}
                  </div>
                  <div class="text-sm text-muted-foreground">
                    {{ conversation?.customer.email }}
                  </div>
                </div>
              </div>
              <div class="space-y-2 text-sm">
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Customer ID:</span>
                  <span>{{ conversation?.customer.id }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Join Date:</span>
                  <span>{{ formatDate(conversation?.customer.joinDate) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Conversations:</span>
                  <span>{{
                    conversation?.customer.totalConversations || 0
                  }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Satisfaction:</span>
                  <div class="flex items-center space-x-1">
                    <Star class="h-3 w-3 text-yellow-500 fill-current" />
                    <span>{{
                      conversation?.customer.avgSatisfaction || "N/A"
                    }}</span>
                  </div>
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
                <span>{{ conversation?.agent.name }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Channel:</span>
                <span>{{ conversation?.channel || "Web Chat" }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Duration:</span>
                <span>{{ formatDuration(conversation?.duration) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Messages:</span>
                <span>{{ messages.length }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Created:</span>
                <span>{{ formatDate(conversation?.createdAt) }}</span>
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
                  class="p-3 border rounded-md hover:bg-muted/50 cursor-pointer"
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
                  class="p-2 border rounded text-sm hover:bg-muted/50 cursor-pointer"
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
  User,
  Bot,
  Clock,
  Paperclip,
  Zap,
  Check,
  Edit,
  X,
  Send,
  AlertTriangle,
  Star,
  Ticket,
  Mail,
  Phone,
  Circle,
  CheckCircle,
  XCircle,
  UserPlus,
  ArrowRight,
} from "lucide-vue-next";

// TODO: Import actual Badge component when available
const Badge = ({ variant = "default", ...props }) =>
  h("span", {
    class: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      variant === "outline"
        ? "border border-gray-300 text-gray-700"
        : variant === "secondary"
        ? "bg-blue-100 text-blue-800"
        : variant === "destructive"
        ? "bg-red-100 text-red-800"
        : variant === "success"
        ? "bg-green-100 text-green-800"
        : variant === "warning"
        ? "bg-yellow-100 text-yellow-800"
        : "bg-gray-100 text-gray-800"
    }`,
    ...props,
  });

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

// Mock data - TODO: Replace with actual API calls
const conversation = ref({
  id: conversationId,
  customer: {
    id: "cust_123",
    name: "Alice Johnson",
    email: "alice@example.com",
    joinDate: new Date("2023-06-15"),
    totalConversations: 8,
    avgSatisfaction: 4.5,
  },
  agent: {
    name: "Customer Support Agent",
  },
  status: "active",
  channel: "Web Chat",
  duration: 485,
  createdAt: new Date("2024-01-15T14:22:00"),
  updatedAt: new Date("2024-01-15T14:30:00"),
});

const messages = ref([
  {
    id: "1",
    sender: "customer",
    content:
      "Hello, I need help with my billing statement. I see a charge that I don't recognize.",
    timestamp: new Date("2024-01-15T14:22:00"),
    type: "message",
  },
  {
    id: "2",
    sender: "agent",
    agentName: "Customer Support Agent",
    content:
      "Hello! I'd be happy to help you with your billing question. Let me look up your account details.",
    timestamp: new Date("2024-01-15T14:22:30"),
    type: "message",
    isPlaybook: true,
  },
  {
    id: "3",
    type: "system",
    action: "agent_joined",
    content: "Agent joined the conversation",
    timestamp: new Date("2024-01-15T14:23:00"),
  },
  {
    id: "4",
    sender: "agent",
    agentName: "Customer Support Agent",
    content:
      "I can see your recent billing statement. Could you tell me the specific charge amount and date you're asking about?",
    timestamp: new Date("2024-01-15T14:23:15"),
    type: "message",
  },
  {
    id: "5",
    sender: "customer",
    content:
      "It's a charge for $29.99 on January 10th. The description just says \"Service Fee\" but I don't know what that's for.",
    timestamp: new Date("2024-01-15T14:24:00"),
    type: "message",
  },
  {
    id: "6",
    sender: "agent",
    agentName: "Customer Support Agent",
    content:
      "I understand your concern. Let me investigate this Service Fee charge for you. This might be related to a premium feature activation or an add-on service.",
    timestamp: new Date("2024-01-15T14:24:30"),
    type: "message",
    needsApproval: false,
  },
]);

const previousConversations = ref([
  {
    id: "conv_2",
    subject: "Account Setup Help",
    status: "resolved",
    createdAt: new Date("2023-12-20"),
  },
  {
    id: "conv_1",
    subject: "Password Reset",
    status: "resolved",
    createdAt: new Date("2023-11-15"),
  },
]);

const relatedArticles = ref([
  {
    id: "kb_1",
    title: "Understanding Your Bill",
    category: "Billing",
  },
  {
    id: "kb_2",
    title: "Service Fees Explained",
    category: "Billing",
  },
  {
    id: "kb_3",
    title: "How to Dispute Charges",
    category: "Support",
  },
]);

// Methods
const goBack = () => {
  navigateTo("/conversations");
};

const getStatusVariant = (status: string) => {
  const variants = {
    active: "default",
    resolved: "success",
    escalated: "warning",
    closed: "secondary",
  };
  return variants[status as keyof typeof variants] || "default";
};

const getStatusIcon = (status: string) => {
  const icons = {
    active: Circle,
    resolved: CheckCircle,
    escalated: AlertTriangle,
    closed: XCircle,
  };
  return icons[status as keyof typeof icons] || Circle;
};

const getSystemMessageIcon = (action: string) => {
  const icons = {
    agent_joined: UserPlus,
    escalated: AlertTriangle,
    transferred: ArrowRight,
  };
  return icons[action as keyof typeof icons] || Circle;
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const formatTime = (date: Date) => {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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

const sendMessage = () => {
  if (!newMessage.value.trim()) return;

  const message = {
    id: `msg_${Date.now()}`,
    sender: "human",
    content: newMessage.value,
    timestamp: new Date(),
    type: "message",
  };

  messages.value.push(message);
  newMessage.value = "";

  // TODO: Send message via API
  console.log("Send message:", message);

  scrollToBottom();
};

const approveMessage = (messageId: string) => {
  // TODO: Approve agent message
  console.log("Approve message:", messageId);
  const message = messages.value.find((m) => m.id === messageId);
  if (message) {
    message.needsApproval = false;
  }
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

// Lifecycle
onMounted(async () => {
  // TODO: Fetch conversation data from API
  // await fetchConversation(conversationId)
  // await fetchMessages(conversationId)
  // setupWebSocketConnection()

  // Simulate loading
  setTimeout(() => {
    loading.value = false;
    scrollToBottom();
  }, 1000);

  // Simulate typing indicator
  setTimeout(() => {
    isTyping.value = true;
    setTimeout(() => {
      isTyping.value = false;
    }, 2000);
  }, 3000);
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
  title: `Conversation with ${
    conversation.value?.customer.name || "Customer"
  } - Hay Dashboard`,
});
</script>
