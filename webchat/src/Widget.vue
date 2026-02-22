<template>
  <div class="hay-webchat-widget">
    <!-- Chat Window -->
    <Transition name="fade">
      <ChatWindow
        v-if="isOpen"
        :widget-title="config.widgetTitle || t('widget.defaultTitle')"
        :widget-subtitle="config.widgetSubtitle || t('widget.defaultSubtitle')"
        :position="config.position || 'right'"
        :show-greeting="config.showGreeting ?? true"
        :greeting-message="config.greetingMessage || t('widget.defaultGreeting')"
        :messages="messages"
        :is-typing="isTyping"
        :is-connected="isConnected"
        :is-conversation-closed="isConversationClosed"
        :is-expanded="isExpanded"
        :agent-name="config.agentName"
        :agent-avatar-url="resolvedAvatarUrl"
        :organization-logo-url="resolvedLogoUrl"
        :current-agent-type="currentAgentType"
        :current-agent-name="currentAgentName"
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
import type { HayChatConfig } from "./types";

const props = defineProps<{
  config: HayChatConfig;
}>();

const t = provideI18n(props.config.locale);

const isExpanded = ref(false);

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value;
};

// Resolve relative image URLs to absolute using baseUrl
const resolvedAvatarUrl = computed(() => {
  if (!props.config.agentAvatarUrl) return undefined;
  if (props.config.agentAvatarUrl.startsWith("http")) return props.config.agentAvatarUrl;
  return `${props.config.baseUrl}${props.config.agentAvatarUrl}`;
});

const resolvedLogoUrl = computed(() => {
  if (!props.config.organizationLogoUrl) return undefined;
  if (props.config.organizationLogoUrl.startsWith("http")) return props.config.organizationLogoUrl;
  return `${props.config.baseUrl}${props.config.organizationLogoUrl}`;
});

const {
  isOpen,
  isConnected,
  messages,
  isTyping,
  unreadCount,
  isConversationClosed,
  currentAgentType,
  currentAgentName,
  initialize,
  toggleChat,
  openChat,
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
