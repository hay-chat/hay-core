<template>
  <div class="hay-message-list" ref="messageListRef">
    <div v-if="messages.length === 0" class="hay-message-list__empty">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      <p>Start a conversation</p>
    </div>

    <div
      v-for="message in messages"
      :key="message.id"
      class="hay-message"
      :class="{
        'hay-message--user': message.sender === 'user',
        'hay-message--agent': message.sender === 'agent',
        'hay-message--closure': message.metadata?.isClosureMessage,
      }"
    >
      <div v-if="message.metadata?.isClosureMessage" class="hay-message__closure-badge">
        🔒 Conversation Closed
      </div>
      <div class="hay-message__content">
        {{ message.content }}
      </div>
      <div class="hay-message__time">
        {{ formatTime(message.timestamp) }}
      </div>
    </div>

    <div v-if="isTyping" class="hay-message hay-message--agent">
      <div class="hay-message__content hay-message__typing">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import type { Message } from '@/types';

const props = defineProps<{
  messages: Message[];
  isTyping: boolean;
}>();

const messageListRef = ref<HTMLElement | null>(null);

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
};

const scrollToBottom = () => {
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
    }
  });
};

// Scroll to bottom when messages change
watch(
  () => [props.messages.length, props.isTyping],
  () => {
    scrollToBottom();
  },
  { immediate: true }
);
</script>

<style scoped>
.hay-message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #f9fafb;
}

.hay-message-list__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
  gap: 12px;
}

.hay-message-list__empty p {
  margin: 0;
  font-size: 14px;
}

.hay-message {
  display: flex;
  flex-direction: column;
  max-width: 80%;
  animation: slideIn 0.2s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.hay-message--user {
  align-self: flex-end;
}

.hay-message--agent {
  align-self: flex-start;
}

.hay-message__content {
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.5;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.hay-message--user .hay-message__content {
  background: var(--hay-primary);
  color: white;
  border-bottom-right-radius: 4px;
}

.hay-message--agent .hay-message__content {
  background: white;
  color: #1f2937;
  border-bottom-left-radius: 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.hay-message__time {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
  padding: 0 4px;
}

.hay-message--user .hay-message__time {
  text-align: right;
}

.hay-message__typing {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 12px 16px;
}

.hay-message__typing span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
  animation: typing 1.4s infinite;
}

.hay-message__typing span:nth-child(2) {
  animation-delay: 0.2s;
}

.hay-message__typing span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.7;
  }
  30% {
    transform: translateY(-10px);
    opacity: 1;
  }
}

/* Closure message styling */
.hay-message--closure {
  opacity: 0.85;
}

.hay-message__closure-badge {
  font-size: 11px;
  color: #dc2626;
  font-weight: 600;
  margin-bottom: 4px;
  padding: 4px 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  display: inline-block;
  align-self: flex-start;
}

.hay-message--closure .hay-message__content {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #7f1d1d;
}
</style>
