<template>
  <div class="min-h-screen">
    <div class="container mx-auto py-8 space-y-8">
      <div class="text-center space-y-2">
        <h1 class="text-3xl font-bold">Web Chat Widget Demo</h1>
        <p class="text-gray-600">Test the Hay webchat plugin with DPoP authentication</p>
      </div>

      <!-- Info Cards -->
      <div class="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <div class="flex items-center gap-2">
              <Shield class="w-5 h-5 text-blue-600" />
              <CardTitle class="text-base">Secure Authentication</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p class="text-sm text-gray-600">ECDSA P-256 keypairs stored locally in your browser</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div class="flex items-center gap-2">
              <Key class="w-5 h-5 text-blue-600" />
              <CardTitle class="text-base">DPoP Proofs</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p class="text-sm text-gray-600">
              Each request includes a signed JWT proving key possession
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div class="flex items-center gap-2">
              <RefreshCw class="w-5 h-5 text-blue-600" />
              <CardTitle class="text-base">Replay Protection</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p class="text-sm text-gray-600">
              Single-use nonces and JTI tracking prevent replay attacks
            </p>
          </CardContent>
        </Card>
      </div>

      <!-- Main Content -->
      <div class="grid gap-8 lg:grid-cols-2">
        <!-- Info -->
        <div>
          <h2 class="text-lg mb-4">Try the chat widget</h2>
          <Card>
            <CardContent class="pt-6">
              <p class="text-sm text-gray-600 mb-4">
                The Hay webchat widget will appear in the bottom-right corner of this page. Click on
                it to start a conversation.
              </p>
              <div class="space-y-2 text-sm">
                <div class="flex items-center gap-2">
                  <span class="text-green-600">✓</span>
                  <span>Anonymous conversations</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-green-600">✓</span>
                  <span>Cryptographically authenticated</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-green-600">✓</span>
                  <span>No cookies or tracking</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <!-- Controls -->
        <div class="space-y-4">
          <h2 class="text-lg mb-4">Session Management</h2>

          <Card>
            <CardHeader>
              <CardTitle class="text-base">Current Session</CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="text-sm space-y-2">
                <div>
                  <span class="font-medium">Status:</span>
                  <span class="ml-2">{{ sessionInfo.hasKeypair ? "Active" : "No session" }}</span>
                </div>
                <div v-if="sessionInfo.conversationId">
                  <span class="font-medium">Conversation:</span>
                  <code class="ml-2 text-xs bg-gray-100 px-2 py-1 rounded">
                    {{ sessionInfo.conversationId.substring(0, 8) }}...
                  </code>
                </div>
                <div>
                  <span class="font-medium">WebCrypto:</span>
                  <span class="ml-2">{{
                    sessionInfo.cryptoAvailable ? "Available" : "Not available"
                  }}</span>
                </div>
              </div>

              <div class="flex gap-2 pt-2">
                <Button @click="clearSession" variant="outline" size="sm">
                  <Trash2 class="w-4 h-4 mr-2" />
                  Clear Session
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="!sessionInfo.hasKeypair"
                  @click="exportKeypair"
                >
                  <Download class="w-4 h-4 mr-2" />
                  Export Keys
                </Button>
              </div>
            </CardContent>
          </Card>

          <!-- Implementation Example -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base">Implementation Code</CardTitle>
            </CardHeader>
            <CardContent>
              <pre
                class="bg-gray-100 p-3 rounded text-xs overflow-x-auto"
              ><code class="language-html">{{ implementationExample }}</code></pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import Card from "@/components/ui/Card.vue";
import CardContent from "@/components/ui/CardContent.vue";
import CardHeader from "@/components/ui/CardHeader.vue";
import CardTitle from "@/components/ui/CardTitle.vue";
import Button from "@/components/ui/Button.vue";
import { Shield, Key, RefreshCw, Trash2, Download } from "lucide-vue-next";
import {
  isWebCryptoAvailable,
  getKeypair,
  clearAllKeypairs,
  exportKeypairForBackup,
} from "@/utils/dpop-crypto";

// Declare HayChat on window object
declare global {
  interface Window {
    HayChat: {
      config?: {
        organizationId?: string;
        pluginId?: string;
        baseUrl?: string;
        widgetTitle?: string;
        widgetSubtitle?: string;
        position?: string;
        theme?: string;
        showGreeting?: boolean;
        greetingMessage?: string;
      };
    };
  }
}

// State
const sessionInfo = ref({
  conversationId: null as string | null,
  hasKeypair: null as boolean | null,
  cryptoAvailable: false,
});

// Polling interval
let pollingInterval: ReturnType<typeof setInterval> | null = null;

// Load session info
async function loadSessionInfo() {
  sessionInfo.value.cryptoAvailable = isWebCryptoAvailable();
  const currentConversationId = sessionStorage.getItem("hay-conversation-id");

  // Check if conversation ID has changed
  if (currentConversationId !== sessionInfo.value.conversationId) {
    const previousId = sessionInfo.value.conversationId;
    sessionInfo.value.conversationId = currentConversationId;

    // If conversation ID changed from a value to a different value (not from null)
    if (previousId && currentConversationId && previousId !== currentConversationId) {
      console.log("Conversation changed, reloading widget...");
      reloadWidget();
    }
  }

  if (sessionInfo.value.conversationId) {
    const keypair = await getKeypair(sessionInfo.value.conversationId);
    sessionInfo.value.hasKeypair = !!keypair;
  } else {
    sessionInfo.value.hasKeypair = false;
  }
}

// Reload the widget
function reloadWidget() {
  // Remove existing widget
  const existingWidget = document.querySelector(".hay-webchat-widget");
  if (existingWidget) {
    existingWidget.remove();
  }

  // Remove existing script
  const existingScript = document.querySelector('script[src*="hay-plugin-webchat/widget.js"]');
  if (existingScript) {
    existingScript.remove();
  }

  // Reload the widget script with new timestamp to force refresh
  const script = document.createElement("script");
  script.src = "http://localhost:3001/plugins/assets/hay-plugin-webchat/widget.js?v=" + Date.now();
  script.async = true;
  document.body.appendChild(script);
}

// Start polling for session changes
function startPolling() {
  stopPolling();
  pollingInterval = setInterval(() => {
    loadSessionInfo();
  }, 1000); // Check every second for changes
}

// Stop polling
function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// Clear session
async function clearSession() {
  await clearAllKeypairs();
  sessionStorage.removeItem("hay-conversation-id");
  await loadSessionInfo();

  // Reload the page to reset the embed
  window.location.reload();
}

// Export keypair
async function exportKeypair() {
  if (!sessionInfo.value.conversationId) return;

  try {
    const exported = await exportKeypairForBackup(sessionInfo.value.conversationId);
    if (exported) {
      const blob = new Blob([JSON.stringify(exported, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hay-keypair-${sessionInfo.value.conversationId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      alert("Could not export keypair. Keys may not be extractable.");
    }
  } catch (error) {
    console.error("Failed to export keypair:", error);
    alert("Failed to export keypair");
  }
}

// Implementation example
const implementationExample = `<!-- Hay Webchat Widget -->
<${"script"}>
  window.HayChat = window.HayChat || {};
  window.HayChat.config = {
    organizationId: "YOUR_ORG_ID",
    pluginId: "hay-plugin-webchat",
    baseUrl: "https://api.your-domain.com",

    // Widget customization
    widgetTitle: "Chat with us",
    widgetSubtitle: "We're here to help!",
    position: "right",
    theme: "blue",
    showGreeting: true,
    greetingMessage: "👋 Hello! How can I help you today?"
  };
</${"script"}>
<${"script"}
  src="https://api.your-domain.com/plugins/assets/hay-plugin-webchat/widget.js"
  async>
</${"script"}>
<link
  rel="stylesheet"
  href="https://api.your-domain.com/plugins/assets/hay-plugin-webchat/widget.css"
/>`;

// Initialize the widget on this page
onMounted(() => {
  loadSessionInfo();

  // Configure and load the Hay webchat widget
  window.HayChat = window.HayChat || {};
  window.HayChat.config = {
    organizationId: "c3578568-c83b-493f-991c-ca2d34a3bd17",
    pluginId: "hay-plugin-webchat",
    baseUrl: "http://localhost:3001",

    // Widget customization for demo
    widgetTitle: "Chat with us",
    widgetSubtitle: "Test DPoP authentication",
    position: "right",
    theme: "blue",
    showGreeting: true,
    greetingMessage:
      "👋 Hello! This is a demo of anonymous-but-authenticated conversations using DPoP.",
  };

  // Load the widget script
  const script = document.createElement("script");
  script.src = "http://localhost:3001/plugins/assets/hay-plugin-webchat/widget.js?v=" + Date.now();
  script.async = true;
  document.body.appendChild(script);

  // Load the widget styles
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "http://localhost:3001/plugins/assets/hay-plugin-webchat/widget.css";
  document.head.appendChild(link);

  // Start polling for session changes
  startPolling();
});

// Clean up on unmount
onBeforeUnmount(() => {
  // Stop polling
  stopPolling();

  // Remove the widget if it exists
  const widget = document.querySelector(".hay-webchat-widget");
  if (widget) {
    widget.remove();
  }
});
</script>
