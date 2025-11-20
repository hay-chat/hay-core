<template>
  <div class="hay-webchat-widget">
    <!-- Chat Window -->
    <Transition name="fade">
      <ChatWindow
        v-if="isOpen"
        :widget-title="config.widgetTitle || 'Chat with us'"
        :widget-subtitle="config.widgetSubtitle"
        :position="config.position || 'right'"
        :show-greeting="config.showGreeting ?? true"
        :greeting-message="config.greetingMessage"
        :messages="messages"
        :is-typing="isTyping"
        :is-connected="isConnected"
        :is-conversation-closed="isConversationClosed"
        @close="closeChat"
        @send="sendMessage"
        @start-typing="startTyping"
        @stop-typing="stopTyping"
        @start-new-conversation="startNewConversation"
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
import { onMounted } from 'vue';
import ChatWindow from './components/ChatWindow.vue';
import MinimizedButton from './components/MinimizedButton.vue';
import { useChat } from './composables/useChat';
import type { HayChatConfig } from './types';

const props = defineProps<{
  config: HayChatConfig;
}>();

const {
  isOpen,
  isConnected,
  messages,
  isTyping,
  unreadCount,
  isConversationClosed,
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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
    Arial, sans-serif;
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
