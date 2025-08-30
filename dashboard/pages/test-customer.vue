<template>
  <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
    <div class="max-w-4xl mx-auto">
      <!-- Header -->
      <div class="mb-8 text-center">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">Customer Test Interface</h1>
        <p class="text-gray-600">Simulate customer conversations to test the orchestrator</p>
        <NuxtLink to="/conversations" class="text-blue-600 hover:underline text-sm">
          ← Back to Conversations Dashboard
        </NuxtLink>
      </div>

      <!-- Configuration Panel -->
      <Card class="mb-6">
        <CardHeader>
          <h2 class="text-lg font-semibold">Test Configuration</h2>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1">Customer Name</label>
              <Input v-model="customerName" placeholder="John Doe" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Customer Email</label>
              <Input v-model="customerEmail" placeholder="john@example.com" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Select Playbook</label>
              <select 
                v-model="selectedPlaybookId" 
                class="w-full px-3 py-2 border rounded-md"
              >
                <option value="">No playbook (free chat)</option>
                <option v-for="playbook in playbooks" :key="playbook.id" :value="playbook.id">
                  {{ playbook.name }}
                </option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Initial Message (Optional)</label>
              <Input v-model="initialMessage" placeholder="Hi, I need help with..." />
            </div>
          </div>
          
          <div class="flex justify-end space-x-2">
            <Button 
              @click="startNewConversation" 
              :disabled="!customerName || !customerEmail || isStartingConversation"
            >
              <MessageSquare class="h-4 w-4 mr-2" />
              {{ isStartingConversation ? 'Starting...' : 'Start New Conversation' }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- Active Conversation -->
      <Card v-if="activeConversation" class="mb-6">
        <CardHeader class="border-b">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <div class="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                <User class="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 class="font-semibold">{{ customerName }}</h3>
                <p class="text-sm text-gray-500">Conversation #{{ activeConversation.id.slice(0, 8) }}</p>
              </div>
            </div>
            <div class="flex items-center space-x-2">
              <Badge :variant="getStatusVariant(activeConversation.status)">
                {{ activeConversation.status }}
              </Badge>
              <Button variant="outline" size="sm" @click="endConversation">
                <X class="h-4 w-4 mr-1" />
                End
              </Button>
            </div>
          </div>
        </CardHeader>
        
        <CardContent class="p-0">
          <!-- Messages -->
          <div class="h-96 overflow-y-auto p-4 space-y-4">
            <div v-if="messages.length === 0" class="text-center text-gray-500 py-8">
              <MessageSquare class="h-12 w-12 mx-auto mb-2 text-gray-300" />
              <p>No messages yet. Send a message to start the conversation.</p>
            </div>
            
            <div 
              v-for="message in messages" 
              :key="message.id"
              :class="[
                'flex',
                message.type === 'HumanMessage' ? 'justify-end' : 'justify-start'
              ]"
            >
              <div 
                :class="[
                  'max-w-xs lg:max-w-md px-4 py-2 rounded-lg',
                  message.type === 'HumanMessage' 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-gray-200 text-gray-900'
                ]"
              >
                <div class="text-sm font-medium mb-1">
                  {{ message.type === 'HumanMessage' ? 'You' : 'Agent' }}
                </div>
                <div>{{ message.content }}</div>
                <div class="text-xs mt-1 opacity-70">
                  {{ formatTime(message.created_at) }}
                </div>
              </div>
            </div>
            
            <!-- Typing indicator -->
            <div v-if="isAgentTyping" class="flex justify-start">
              <div class="bg-gray-200 rounded-lg px-4 py-2">
                <div class="flex space-x-1">
                  <div class="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style="animation-delay: 0ms"></div>
                  <div class="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style="animation-delay: 150ms"></div>
                  <div class="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style="animation-delay: 300ms"></div>
                </div>
              </div>
            </div>
            
            <div ref="messagesEnd"></div>
          </div>
          
          <!-- Message Input -->
          <div class="border-t p-4">
            <div class="flex space-x-2">
              <Input 
                v-model="messageInput" 
                placeholder="Type your message..."
                @keyup.enter="sendMessage"
                :disabled="!activeConversation || isSending"
                class="flex-1"
              />
              <Button 
                @click="sendMessage" 
                :disabled="!messageInput.trim() || isSending"
              >
                <Send class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Orchestrator Status -->
      <Card v-if="activeConversation">
        <CardHeader>
          <h3 class="font-semibold">Orchestrator Status</h3>
        </CardHeader>
        <CardContent>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-600">Status:</span>
              <Badge :variant="orchestratorStatus === 'processing' ? 'default' : 'secondary'">
                {{ orchestratorStatus }}
              </Badge>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600">Last Check:</span>
              <span>{{ lastOrchestratorCheck || 'Never' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600">Processing Count:</span>
              <span>{{ processingCount }}</span>
            </div>
            <div v-if="activeConversation.playbook_id" class="flex justify-between">
              <span class="text-gray-600">Active Playbook:</span>
              <span>{{ getPlaybookName(activeConversation.playbook_id) }}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Recent Conversations -->
      <Card class="mt-6">
        <CardHeader>
          <h3 class="font-semibold">Recent Test Conversations</h3>
        </CardHeader>
        <CardContent>
          <div v-if="recentConversations.length === 0" class="text-center py-4 text-gray-500">
            No conversations yet
          </div>
          <div v-else class="space-y-2">
            <div 
              v-for="conv in recentConversations" 
              :key="conv.id"
              class="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 cursor-pointer"
              @click="loadConversation(conv.id)"
            >
              <div>
                <div class="font-medium">{{ conv.metadata?.customer_name || 'Unknown' }}</div>
                <div class="text-sm text-gray-500">
                  {{ conv.message_count }} messages · {{ formatTime(conv.created_at) }}
                </div>
              </div>
              <Badge :variant="getStatusVariant(conv.status)">
                {{ conv.status }}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, h } from 'vue';
import { MessageSquare, User, Send, X } from 'lucide-vue-next';
import { HayApi as Hay } from '../utils/api';

// State
const customerName = ref('Test Customer');
const customerEmail = ref('test@example.com');
const selectedPlaybookId = ref('');
const initialMessage = ref('');
const messageInput = ref('');
const activeConversation = ref<any>(null);
const messages = ref<any[]>([]);
const playbooks = ref<any[]>([]);
const recentConversations = ref<any[]>([]);
const isStartingConversation = ref(false);
const isSending = ref(false);
const isAgentTyping = ref(false);
const orchestratorStatus = ref('idle');
const lastOrchestratorCheck = ref('');
const processingCount = ref(0);
const messagesEnd = ref<HTMLElement>();

// Polling interval
let pollingInterval: NodeJS.Timeout | null = null;

// Badge component (temporary)
const Badge = ({ variant = "default", ...props }) =>
  h("span", {
    class: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      variant === "default"
        ? "bg-blue-100 text-blue-800"
        : variant === "secondary"
        ? "bg-gray-100 text-gray-800"
        : variant === "success"
        ? "bg-green-100 text-green-800"
        : variant === "warning"
        ? "bg-yellow-100 text-yellow-800"
        : "bg-gray-100 text-gray-800"
    }`,
    ...props,
  });

// Methods
const getStatusVariant = (status: string) => {
  const variants: Record<string, string> = {
    open: 'default',
    active: 'default',
    processing: 'warning',
    resolved: 'success',
    closed: 'secondary',
    pending_human: 'warning',
  };
  return variants[status] || 'default';
};

const formatTime = (date: string | Date) => {
  const d = new Date(date);
  return d.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
};

const getPlaybookName = (id: string) => {
  const playbook = playbooks.value.find(p => p.id === id);
  return playbook?.name || 'Unknown';
};

const scrollToBottom = () => {
  nextTick(() => {
    messagesEnd.value?.scrollIntoView({ behavior: 'smooth' });
  });
};

const startNewConversation = async () => {
  try {
    isStartingConversation.value = true;
    
    // Create a new conversation
    const response = await Hay.conversations.create.mutate({
      metadata: {
        customer_name: customerName.value,
        customer_email: customerEmail.value,
        source: 'test_interface'
      },
      playbook_id: selectedPlaybookId.value || undefined,
      status: 'open'
    });
    
    activeConversation.value = response;
    messages.value = [];
    
    // Send initial message if provided
    if (initialMessage.value.trim()) {
      await sendCustomMessage(initialMessage.value);
      initialMessage.value = '';
    }
    
    // Start polling for updates
    startPolling();
    
    // Load recent conversations
    await loadRecentConversations();
  } catch (error) {
    console.error('Failed to start conversation:', error);
    alert('Failed to start conversation. Please check the console.');
  } finally {
    isStartingConversation.value = false;
  }
};

const sendMessage = async () => {
  if (!messageInput.value.trim() || !activeConversation.value) return;
  
  const message = messageInput.value;
  messageInput.value = '';
  await sendCustomMessage(message);
};

const sendCustomMessage = async (content: string) => {
  try {
    isSending.value = true;
    
    // Add message to UI immediately
    const tempMessage = {
      id: Date.now().toString(),
      type: 'HumanMessage',
      content,
      created_at: new Date()
    };
    messages.value.push(tempMessage);
    scrollToBottom();
    
    // Send message to API
    const response = await Hay.conversations.sendMessage.mutate({
      conversationId: activeConversation.value.id,
      content,
      role: 'user'
    });
    
    // Update with actual message from server
    const messageIndex = messages.value.findIndex(m => m.id === tempMessage.id);
    if (messageIndex !== -1) {
      messages.value[messageIndex] = response;
    }
    
    // Show typing indicator
    isAgentTyping.value = true;
    
    // The orchestrator will process this and generate a response
    orchestratorStatus.value = 'processing';
    processingCount.value++;
  } catch (error) {
    console.error('Failed to send message:', error);
    alert('Failed to send message. Please check the console.');
  } finally {
    isSending.value = false;
  }
};

const loadConversation = async (conversationId: string) => {
  try {
    const response = await Hay.conversations.get.query({ id: conversationId });
    activeConversation.value = response;
    messages.value = response.messages || [];
    scrollToBottom();
    
    // Start polling for this conversation
    startPolling();
  } catch (error) {
    console.error('Failed to load conversation:', error);
  }
};

const endConversation = async () => {
  if (!activeConversation.value) return;
  
  try {
    await Hay.conversations.update.mutate({
      id: activeConversation.value.id,
      data: {
        status: 'closed'
      }
    });
    
    stopPolling();
    activeConversation.value = null;
    messages.value = [];
    await loadRecentConversations();
  } catch (error) {
    console.error('Failed to end conversation:', error);
  }
};

const loadRecentConversations = async () => {
  try {
    const response = await Hay.conversations.list.query({
      limit: 10,
      orderBy: 'created_at',
      orderDirection: 'desc'
    });
    recentConversations.value = response.items || [];
  } catch (error) {
    console.error('Failed to load recent conversations:', error);
  }
};

const loadPlaybooks = async () => {
  try {
    const response = await Hay.playbooks.list.query();
    playbooks.value = Array.isArray(response) ? response : (response as any)?.items || [];
  } catch (error) {
    console.error('Failed to load playbooks:', error);
  }
};

const pollConversation = async () => {
  if (!activeConversation.value) return;
  
  try {
    const response = await Hay.conversations.get.query({ 
      id: activeConversation.value.id 
    });
    
    // Update conversation status
    activeConversation.value = response;
    
    // Check for new messages
    const newMessages = response.messages || [];
    if (newMessages.length > messages.value.length) {
      messages.value = newMessages;
      isAgentTyping.value = false;
      scrollToBottom();
    }
    
    // Update orchestrator status
    lastOrchestratorCheck.value = new Date().toLocaleTimeString();
    if (response.status === 'processing') {
      orchestratorStatus.value = 'processing';
    } else {
      orchestratorStatus.value = 'idle';
    }
  } catch (error) {
    console.error('Failed to poll conversation:', error);
  }
};

const startPolling = () => {
  stopPolling();
  pollingInterval = setInterval(pollConversation, 2000); // Poll every 2 seconds
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
  await loadRecentConversations();
});

onUnmounted(() => {
  stopPolling();
});

// Page meta
definePageMeta({
  layout: 'default',
});

// Head
useHead({
  title: 'Customer Test Interface - Hay Dashboard',
});
</script>

<style scoped>
@keyframes bounce {
  0%, 80%, 100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-10px);
  }
}
</style>