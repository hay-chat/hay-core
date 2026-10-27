<template>
  <div v-if="!hidden" class="hay-webchat-widget">
    <!-- Chat Window -->
    <Transition name="fade">
      <ChatWindow
        v-if="isOpen"
        :widget-title="config.widgetTitle || t('widget.defaultTitle')"
        :widget-subtitle="widgetSubtitle"
        :position="config.position || 'right'"
        :show-greeting="config.showGreeting ?? true"
        :greeting-message="config.greetingMessage || t('widget.defaultGreeting')"
        :messages="messages"
        :is-typing="isTyping"
        :is-connected="isConnected"
        :is-conversation-closed="isConversationClosed"
        :is-expanded="isExpanded"
        :agent-name="resolvedAgentName"
        :agent-avatar-url="resolvedAvatarUrl"
        :organization-logo-url="resolvedLogoUrl"
        :current-agent-type="currentAgentType"
        :current-agent-name="currentAgentName || undefined"
        @close="closeChat"
        @send="sendMessage"
        @start-typing="startTyping"
        @stop-typing="stopTyping"
        @start-new-conversation="startNewConversation"
        @toggle-expand="toggleExpand"
      />
    </Transition>

    <!-- Minimized Button -->
    <MinimizedButton
      :is-open="isOpen"
      :position="config.position || 'right'"
      :unread-count="unreadCount"
      @toggle="toggleChat"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import ChatWindow from "./components/ChatWindow.vue";
import MinimizedButton from "./components/MinimizedButton.vue";
import { useChat } from "./composables/useChat";
import { provideI18n } from "./i18n";
import { debugLog } from "./utils/debug";
import { resolveWidgetSubtitle } from "./utils/subtitle";
import type { HayChatConfig } from "./types";

const props = defineProps<{
  config: HayChatConfig;
}>();

const t = provideI18n(props.config.locale);

const widgetSubtitle = computed(() =>
  resolveWidgetSubtitle(props.config.widgetSubtitle, t("widget.defaultSubtitle")),
);

const isExpanded = ref(false);

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value;
};

// Set when the backend reports the widget must not render (disabled/suspended)
const hidden = ref(false);

// Fetched config from the backend (fills in values not provided by the host)
const fetchedConfig = ref<{
  agentName?: string | null;
  agentAvatarUrl?: string | null;
  organizationLogoUrl?: string | null;
}>({});

const fetchPublicConfig = async () => {
  try {
    const input = JSON.stringify({ organizationId: props.config.organizationId });
    const url = `${props.config.baseUrl}/v1/webchat.getPublicConfig?input=${encodeURIComponent(input)}`;
    debugLog("[Hay Webchat] Fetching public config from:", url);

    const response = await fetch(url);
    if (!response.ok) {
      console.warn(
        "[Hay Webchat] Public config fetch failed:",
        response.status,
        response.statusText,
      );
      return;
    }

    const data = await response.json();
    const result = data?.result?.data;
    debugLog("[Hay Webchat] Public config received:", result);

    // Webchat disabled or organization suspended: render nothing at all.
    if (result?.enabled === false) {
      hidden.value = true;
      return;
    }

    if (result) {
      fetchedConfig.value = {
        agentName: result.agentName,
        agentAvatarUrl: result.agentAvatarUrl,
        organizationLogoUrl: result.organizationLogoUrl,
      };
      debugLog("[Hay Webchat] Resolved avatar URL:", resolvedAvatarUrl.value);
      debugLog("[Hay Webchat] Resolved logo URL:", resolvedLogoUrl.value);
      debugLog("[Hay Webchat] Resolved agent name:", resolvedAgentName.value);
    }
  } catch (error) {
    console.warn("[Hay Webchat] Failed to fetch public config:", error);
  }
};

onMounted(() => {
  fetchPublicConfig();
});

// Resolve a relative image URL to absolute using baseUrl
const resolveUrl = (url: string | undefined | null): string | undefined => {
  if (!url) return undefined;
  if (url.startsWith("http")) return url;
  return `${props.config.baseUrl}${url}`;
};

// Host-provided config takes priority, fetched config fills in gaps
const resolvedAvatarUrl = computed(() =>
  resolveUrl(props.config.agentAvatarUrl || fetchedConfig.value.agentAvatarUrl),
);

const resolvedLogoUrl = computed(() =>
  resolveUrl(props.config.organizationLogoUrl || fetchedConfig.value.organizationLogoUrl),
);

const resolvedAgentName = computed(
  () => props.config.agentName || fetchedConfig.value.agentName || undefined,
);

const {
  isOpen,
  isConnected,
  messages,
  isTyping,
  unreadCount,
  isConversationClosed,
  currentAgentType,
  currentAgentName,
  toggleChat,
  closeChat,
  sendMessage,
  startTyping,
  stopTyping,
  startNewConversation,
} = useChat(props.config);

// Initialize on mount if configured to auto-open
onMounted(() => {
  // Could add auto-open feature here if needed
  // For now, widget waits for user to click
});
</script>

<style>
/* Global styles for the widget */
.hay-webchat-widget {
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.hay-webchat-widget * {
  box-sizing: border-box;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
