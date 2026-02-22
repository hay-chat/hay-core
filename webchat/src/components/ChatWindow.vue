<template>
  <div class="hay-chat-window" :class="{ 'hay-chat-window--left': position === 'left' }">
    <!-- Header -->
    <div class="hay-chat-header">
      <div class="hay-chat-header__content">
        <div class="hay-chat-header__title">{{ widgetTitle }}</div>
        <div v-if="widgetSubtitle" class="hay-chat-header__subtitle">
          {{ widgetSubtitle }}
        </div>
      </div>
      <button @click="$emit('close')" class="hay-chat-header__close" :aria-label="t('chat.close')">
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

    <!-- Skeleton loading while connecting -->
    <div v-if="!isConnected" class="hay-chat-skeleton">
      <div class="hay-chat-skeleton__message hay-chat-skeleton__message--agent">
        <div class="hay-chat-skeleton__line" style="width: 70%"></div>
        <div class="hay-chat-skeleton__line" style="width: 50%"></div>
      </div>
      <div class="hay-chat-skeleton__message hay-chat-skeleton__message--user">
        <div class="hay-chat-skeleton__line" style="width: 40%"></div>
      </div>
      <div class="hay-chat-skeleton__message hay-chat-skeleton__message--agent">
        <div class="hay-chat-skeleton__line" style="width: 60%"></div>
        <div class="hay-chat-skeleton__line" style="width: 75%"></div>
        <div class="hay-chat-skeleton__line" style="width: 35%"></div>
      </div>
    </div>

    <!-- Greeting Message -->
    <div
      v-else-if="showGreeting && greetingMessage && messages.length === 0"
      class="hay-chat-greeting hay-message hay-message--agent"
    >
      <div class="hay-message__content">{{ greetingMessage }}</div>
    </div>

    <!-- Messages -->
    <MessageList :messages="messages" :is-typing="isTyping" />

    <!-- Closed Conversation Footer (replaces input when closed) -->
    <div v-if="isConversationClosed" class="hay-chat-closed-footer">
      <div class="hay-chat-closed-footer__content">
        <span class="hay-chat-closed-footer__text">{{ t("chat.conversationEnded") }}</span>
      </div>
      <button @click="$emit('startNewConversation')" class="hay-chat-closed-footer__button">
        {{ t("chat.startNew") }}
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

    <!-- Powered by Hay -->
    <a :href="poweredByUrl" target="_blank" rel="noopener noreferrer" class="hay-powered-by">
      {{ t("chat.poweredBy") }}
      <svg
        width="684"
        height="238"
        viewBox="0 0 684 238"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class="hay-powered-by__logo"
        alt="Hay"
      >
        <path
          d="M167.884 0C198.661 0 214.049 0.00037514 223.61 9.56152C233.172 19.1227 233.172 34.511 233.172 65.2881V167.884C233.172 198.661 233.172 214.049 223.61 223.61C214.049 233.172 198.661 233.172 167.884 233.172H65.2881C34.511 233.172 19.1227 233.172 9.56152 223.61C0.00037514 214.049 0 198.661 0 167.884V65.2881C0 34.511 0.000305188 19.1227 9.56152 9.56152C19.1227 0.00030087 34.511 0 65.2881 0H167.884ZM143.97 120.49C143.97 18.9343 128.297 37.2143 103.767 123.198C97.6336 3.36215 79.2354 66.3274 51.2979 167.884C85.3681 167.884 174.634 163.821 174.634 163.821C178.722 111.012 192.35 11.4868 143.97 120.49Z"
          fill="#1D293D"
        />
        <path
          d="M569.916 227.368L581.824 207.591C581.824 207.591 588.629 214.183 595.222 214.183C603.94 214.183 607.555 211.631 612.446 199.297L616.487 188.877L567.364 85.7408H595.647L629.671 159.531L656.253 85.7408H683.685L634.775 209.079C626.056 231.195 611.808 238 596.923 238C581.612 238 569.916 227.368 569.916 227.368Z"
          fill="#1D293D"
        />
        <path
          d="M537.754 85.7402H561.358V186.538H537.754V173.353C537.754 173.353 529.035 189.09 507.344 189.09C481.188 189.09 458.222 167.186 458.222 136.139C458.222 105.092 481.188 83.1884 507.344 83.1884C528.397 83.1884 537.754 98.9247 537.754 98.9247V85.7402ZM535.84 151.237V121.041C535.84 121.041 528.397 107.005 512.023 107.005C494.798 107.005 484.165 119.552 484.165 136.139C484.165 152.726 494.798 165.272 512.023 165.272C528.397 165.272 535.84 151.237 535.84 151.237Z"
          fill="#1D293D"
        />
        <path
          d="M419.62 98.2868V37.6807H445.138V186.538H419.62V122.529H356.037V186.538H330.519V37.6807H356.037V98.2868H419.62Z"
          fill="#1D293D"
        />
      </svg>
    </a>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import MessageList from "./MessageList.vue";
import MessageInput from "./MessageInput.vue";
import { useI18n } from "@/i18n";
import type { Message } from "@/types";

const t = useI18n();

const poweredByUrl = computed(() => {
  const url = new URL("https://hay.chat");
  url.searchParams.set("utm_source", window.location.hostname);
  url.searchParams.set("utm_medium", "webchat");
  url.searchParams.set("utm_campaign", "powered_by");
  return url.toString();
});

defineProps<{
  widgetTitle: string;
  widgetSubtitle?: string;
  position: "left" | "right";
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

<style>
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

/* Closed conversation footer (replaces input area) */
.hay-chat-closed-footer {
  padding: 16px;
  border-top: 1px solid var(--color-neutral-200);
  background: linear-gradient(to bottom, var(--color-neutral-50), white);
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

.hay-chat-closed-footer__text {
  font-size: 14px;
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

/* Skeleton loading */
.hay-chat-skeleton {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hay-chat-skeleton__message {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 70%;
}

.hay-chat-skeleton__message--agent {
  align-self: flex-start;
}

.hay-chat-skeleton__message--user {
  align-self: flex-end;
}

.hay-chat-skeleton__line {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(
    90deg,
    var(--color-neutral-200) 25%,
    var(--color-neutral-100) 50%,
    var(--color-neutral-200) 75%
  );
  background-size: 400% 100%;
  animation: shimmer 1s infinite;
}

.hay-chat-skeleton__message--user .hay-chat-skeleton__line {
  align-self: flex-end;
  height: 41px;
  border-radius: 12px;
  border-bottom-right-radius: 4px;
}

@keyframes shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: 0% 0;
  }
}

/* Powered by Hay */
.hay-powered-by {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding-block: 6px;
  font-size: 11px;
  color: var(--color-neutral-400);
  text-decoration: none;
  transition: color 0.2s;
}

.hay-powered-by:hover {
  color: var(--color-neutral-500);
}

.hay-powered-by strong {
  font-weight: 600;
  color: inherit;
}

.hay-powered-by__logo {
  flex-shrink: 0;
  border-radius: 3px;
  height: 1.2em;
  width: auto;
}
.hay-powered-by__logo path {
  fill: currentColor;
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
