<template>
  <div class="hay-web-embed">
    <Card class="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>{{ title }}</CardTitle>
        <CardDescription v-if="description">{{ description }}</CardDescription>
      </CardHeader>

      <CardContent class="space-y-4">
        <!-- Connection Status -->
        <div v-if="connectionStatus !== 'connected'" class="text-center py-4">
          <div v-if="connectionStatus === 'initializing'" class="space-y-2">
            <Loader2 class="w-6 h-6 animate-spin mx-auto" />
            <p class="text-sm text-neutral-muted">Initializing secure connection...</p>
          </div>

          <div v-else-if="connectionStatus === 'error'" class="space-y-2">
            <AlertCircle class="w-6 h-6 text-destructive mx-auto" />
            <p class="text-sm text-destructive">{{ errorMessage }}</p>
            <Button variant="outline" size="sm" @click="initialize"> Retry </Button>
          </div>
        </div>

        <!-- Messages -->
        <div v-else ref="messagesContainer" class="h-96 overflow-y-auto space-y-2 px-2">
          <div
            v-for="message in messages"
            :key="message.id"
            :class="['flex', message.direction === 'out' ? 'justify-start' : 'justify-end']"
          >
            <div
              :class="[
                'max-w-[80%] rounded-lg px-3 py-2',
                message.direction === 'out'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'bg-primary text-primary-foreground',
              ]"
            >
              <p class="text-sm whitespace-pre-wrap">{{ message.content }}</p>
              <p class="text-xs opacity-70 mt-1">
                {{ formatTime(message.createdAt) }}
              </p>
            </div>
          </div>

          <!-- Loading indicator -->
          <div v-if="isLoading" class="flex justify-start">
            <div class="bg-secondary text-secondary-foreground rounded-lg px-3 py-2">
              <Loader2 class="w-4 h-4 animate-spin" />
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter v-if="connectionStatus === 'connected'">
        <form @submit.prevent="sendMessage" class="flex w-full gap-2">
          <Input
            v-model="messageInput"
            placeholder="Type your message..."
            :disabled="isLoading || isSending"
            class="flex-1"
          />
          <Button
            type="submit"
            :disabled="!messageInput.trim() || isLoading || isSending"
            size="icon"
          >
            <Send class="w-4 h-4" />
          </Button>
        </form>
      </CardFooter>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue";
import { Loader2, Send, AlertCircle } from "lucide-vue-next";
import {
  generateKeypair,
  storeKeypair,
  getKeypair,
  isWebCryptoAvailable,
} from "@/utils/dpop-crypto";
import { DPoPClient } from "@/utils/dpop-proof";

interface WebEmbedProps {
  title?: string;
  description?: string;
  apiUrl?: string;
  organizationId?: string;
  metadata?: Record<string, any>;
}

const props = withDefaults(defineProps<WebEmbedProps>(), {
  title: "Chat with us",
  description: "",
  apiUrl: "http://localhost:3001",
});

interface Message {
  id: string;
  content: string;
  direction: "in" | "out";
  createdAt: Date;
}

// State
const connectionStatus = ref<"initializing" | "connected" | "error">("initializing");
const errorMessage = ref("");
const messages = ref<Message[]>([]);
const messageInput = ref("");
const isLoading = ref(false);
const isSending = ref(false);
const messagesContainer = ref<HTMLElement>();

// DPoP client and conversation
const dpopClient = ref<DPoPClient | null>(null);
const conversationId = ref<string | null>(null);

// Initialize the web embed
async function initialize() {
  try {
    connectionStatus.value = "initializing";
    errorMessage.value = "";

    // Check WebCrypto support
    if (!isWebCryptoAvailable()) {
      throw new Error(
        "Your browser doesn't support secure authentication. Please use a modern browser.",
      );
    }

    // Check if we have an existing conversation in session storage
    const existingConversationId = sessionStorage.getItem("hay-conversation-id");

    if (existingConversationId) {
      // Try to restore existing conversation
      const existingKeypair = await getKeypair(existingConversationId);

      if (existingKeypair) {
        conversationId.value = existingConversationId;
        dpopClient.value = new DPoPClient(existingConversationId, props.apiUrl);

        // Fetch existing messages
        await fetchMessages();

        connectionStatus.value = "connected";
        return;
      }
    }

    // Generate new keypair
    const { privateKey, publicKey, publicJwk } = await generateKeypair();

    // Create conversation via tRPC
    const response = await fetch(`${props.apiUrl}/v1/webConversations.create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        publicJwk,
        metadata: {
          ...props.metadata,
          organizationId: props.organizationId,
          source: "web-embed",
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "Failed to create conversation");
    }

    const data = await response.json();
    const { id: newConversationId, nonce } = data.result.data;

    // Store keypair and conversation ID
    await storeKeypair(newConversationId, privateKey, publicKey, publicJwk);
    sessionStorage.setItem("hay-conversation-id", newConversationId);

    // Initialize DPoP client
    conversationId.value = newConversationId;
    dpopClient.value = new DPoPClient(newConversationId, props.apiUrl);
    dpopClient.value.setNonce(nonce);

    connectionStatus.value = "connected";

    // Add initial bot message if provided
    if (data.result.data.initialMessage) {
      messages.value.push({
        id: "initial",
        content: data.result.data.initialMessage,
        direction: "out",
        createdAt: new Date(),
      });
    }
  } catch (error) {
    console.error("Failed to initialize web embed:", error);
    connectionStatus.value = "error";
    errorMessage.value = error instanceof Error ? error.message : "Failed to initialize";
  }
}

// Fetch existing messages
async function fetchMessages() {
  if (!dpopClient.value || !conversationId.value) return;

  try {
    isLoading.value = true;

    const { data, nonce } = await dpopClient.value.request(`/v1/webConversations.getMessages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: conversationId.value,
        method: "POST",
        url: `${props.apiUrl}/v1/webConversations.getMessages`,
        limit: 50,
      }),
    });

    messages.value = data.result.data.messages.map((msg: any) => ({
      id: msg.id,
      content: msg.content,
      direction: msg.direction,
      createdAt: new Date(msg.createdAt),
    }));

    dpopClient.value.setNonce(nonce);
    await scrollToBottom();
  } catch (error) {
    console.error("Failed to fetch messages:", error);
  } finally {
    isLoading.value = false;
  }
}

// Send a message
async function sendMessage() {
  if (!messageInput.value.trim() || !dpopClient.value || !conversationId.value) return;

  const content = messageInput.value.trim();
  messageInput.value = "";

  // Add user message immediately
  const userMessage: Message = {
    id: `user-${Date.now()}`,
    content,
    direction: "in",
    createdAt: new Date(),
  };
  messages.value.push(userMessage);
  await scrollToBottom();

  try {
    isSending.value = true;

    const { data, nonce } = await dpopClient.value.request(`/v1/webConversations.sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: conversationId.value,
        content,
        method: "POST",
        url: `${props.apiUrl}/v1/webConversations.sendMessage`,
      }),
    });

    dpopClient.value.setNonce(nonce);

    // Poll for response (in production, use WebSocket or SSE)
    setTimeout(() => {
      fetchMessages();
    }, 1000);
  } catch (error) {
    console.error("Failed to send message:", error);

    // Remove the message on error
    const index = messages.value.findIndex((m) => m.id === userMessage.id);
    if (index > -1) {
      messages.value.splice(index, 1);
    }

    errorMessage.value = "Failed to send message. Please try again.";
  } finally {
    isSending.value = false;
  }
}

// Scroll to bottom of messages
async function scrollToBottom() {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

// Format time
function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

// Initialize on mount
onMounted(() => {
  initialize();
});
</script>

<style scoped>
.hay-web-embed {
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}
</style>
