<template>
  <div
    class="hay-chat-window"
    :class="{ 'hay-chat-window--left': position === 'left' }"
  >
    <!-- Header -->
    <div class="hay-chat-header">
      <div class="hay-chat-header__content">
        <div class="hay-chat-header__title">{{ widgetTitle }}</div>
        <div v-if="widgetSubtitle" class="hay-chat-header__subtitle">
          {{ widgetSubtitle }}
        </div>
      </div>
      <button
        @click="$emit('close')"
        class="hay-chat-header__close"
        aria-label="Close chat"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <!-- Connection Status -->
    <div v-if="!isConnected" class="hay-chat-status">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="hay-chat-status__icon"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>Connecting...</span>
    </div>

    <!-- Greeting Message -->
    <div
      v-if="showGreeting && greetingMessage && messages.length === 0"
      class="hay-chat-greeting"
    >
      {{ greetingMessage }}
    </div>

    <!-- Messages -->
    <MessageList :messages="messages" :is-typing="isTyping" />

    <!-- Closed Conversation Footer (replaces input when closed) -->
    <div v-if="isConversationClosed" class="hay-chat-closed-footer">
      <div class="hay-chat-closed-footer__content">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="hay-chat-closed-footer__icon"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <span class="hay-chat-closed-footer__text">This conversation has ended</span>
      </div>
      <button
        @click="$emit('startNewConversation')"
        class="hay-chat-closed-footer__button"
      >
        Start New Conversation
      </button>
    </div>

    <!-- Input (hidden when conversation is closed) -->
    <MessageInput
      v-else
      :is-connected="isConnected"
      @send="$emit('send', $event)"
      @start-typing="$emit('startTyping')"
      @stop-typing="$emit('stopTyping')"
    />
  </div>
</template>

<script setup lang="ts">
import MessageList from './MessageList.vue';
import MessageInput from './MessageInput.vue';
import type { Message } from '@/types';

defineProps<{
  widgetTitle: string;
  widgetSubtitle?: string;
  position: 'left' | 'right';
  showGreeting: boolean;
  greetingMessage?: string;
  messages: Message[];
  isTyping: boolean;
  isConnected: boolean;
  isConversationClosed: boolean;
}>();

defineEmits<{
  close: [];
  send: [message: string];
  startTyping: [];
  stopTyping: [];
  startNewConversation: [];
}>();
</script>

<style scoped>
.hay-chat-window {
  position: fixed;
  bottom: 90px;
  right: 20px;
  width: 380px;
  height: 600px;
  max-height: calc(100vh - 120px);
  background: white;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  z-index: 999999;
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.hay-chat-window--left {
  left: 20px;
  right: auto;
}

.hay-chat-header {
  background: var(--hay-primary);
  color: white;
  padding: 20px;
  border-radius: 12px 12px 0 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.hay-chat-header__content {
  flex: 1;
}

.hay-chat-header__title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
}

.hay-chat-header__subtitle {
  font-size: 13px;
  opacity: 0.9;
}

.hay-chat-header__close {
  background: transparent;
  border: none;
  color: white;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.2s;
}

.hay-chat-header__close:hover {
  background: rgba(255, 255, 255, 0.1);
}

.hay-chat-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #fef3c7;
  color: #92400e;
  font-size: 13px;
  border-bottom: 1px solid #fde68a;
}

.hay-chat-status__icon {
  flex-shrink: 0;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.hay-chat-greeting {
  padding: 16px;
  margin: 16px;
  background: var(--hay-primary-light);
  color: white;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
}

/* Closed conversation footer (replaces input area) */
.hay-chat-closed-footer {
  padding: 16px;
  background: #fef2f2;
  border-top: 1px solid #fecaca;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hay-chat-closed-footer__content {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
}

.hay-chat-closed-footer__icon {
  flex-shrink: 0;
  color: #dc2626;
}

.hay-chat-closed-footer__text {
  font-size: 14px;
  color: #991b1b;
  font-weight: 500;
}

.hay-chat-closed-footer__button {
  width: 100%;
  padding: 10px 16px;
  background: var(--hay-primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.hay-chat-closed-footer__button:hover {
  opacity: 0.9;
}

.hay-chat-closed-footer__button:active {
  opacity: 0.8;
}

/* Mobile responsiveness */
@media (max-width: 480px) {
  .hay-chat-window {
    width: calc(100vw - 40px);
    height: calc(100vh - 110px);
    max-height: calc(100vh - 110px);
  }
}
</style>
