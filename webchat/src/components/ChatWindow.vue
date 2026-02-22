<template>
  <div
    class="hay-chat-window"
    :class="{
      'hay-chat-window--left': position === 'left',
      'hay-chat-window--expanded': isExpanded,
    }"
  >
    <!-- Header -->
    <div class="hay-chat-header">
      <div class="hay-chat-header__left">
        <div class="hay-chat-header__avatar">
          <img
            v-if="agentAvatarUrl || organizationLogoUrl"
            :src="agentAvatarUrl || organizationLogoUrl"
            alt=""
            class="hay-chat-header__avatar-img"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <svg
            v-else
            class="hay-chat-header__avatar-fallback"
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div class="hay-chat-header__info">
          <span class="hay-chat-header__name">{{ displayName }}</span>
          <span v-if="isShowingTitle && widgetSubtitle" class="hay-chat-header__subtitle">
            {{ widgetSubtitle }}
          </span>
        </div>
      </div>
      <div class="hay-chat-header__actions">
        <button
          @click="$emit('toggleExpand')"
          class="hay-chat-header__action-btn"
          :aria-label="isExpanded ? t('chat.collapse') : t('chat.expand')"
        >
          <!-- Expand icon (arrow-up-right) when collapsed -->
          <svg
            v-if="!isExpanded"
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
          <!-- Collapse icon (arrow-down-left) when expanded -->
          <svg
            v-else
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="4 14 10 14 10 20" />
            <polyline points="20 10 14 10 14 4" />
            <line x1="14" y1="10" x2="21" y2="3" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
        <button
          @click="$emit('close')"
          class="hay-chat-header__action-btn"
          :aria-label="t('chat.close')"
        >
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
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
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

    <!-- Messages -->
    <MessageList
      :messages="messages"
      :is-typing="isTyping"
      :greeting-message="showGreeting && messages.length === 0 ? greetingMessage : undefined"
    />

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

const props = defineProps<{
  widgetTitle: string;
  widgetSubtitle?: string;
  position: "left" | "right";
  showGreeting: boolean;
  greetingMessage?: string;
  messages: Message[];
  isTyping: boolean;
  isConnected: boolean;
  isConversationClosed: boolean;
  isExpanded: boolean;
  agentName?: string;
  agentAvatarUrl?: string;
  organizationLogoUrl?: string;
  currentAgentType?: string;
  currentAgentName?: string;
}>();

defineEmits<{
  close: [];
  send: [message: string];
  startTyping: [];
  stopTyping: [];
  startNewConversation: [];
  toggleExpand: [];
}>();

const isShowingTitle = computed(() => {
  if (props.currentAgentType === "HumanAgent" && props.currentAgentName) return false;
  if (props.agentName) return false;
  return true;
});

const displayName = computed(() => {
  if (props.currentAgentType === "HumanAgent" && props.currentAgentName) {
    return props.currentAgentName;
  }
  return props.agentName || props.widgetTitle;
});

const poweredByUrl = computed(() => {
  const url = new URL("https://hay.chat");
  url.searchParams.set("utm_source", window.location.hostname);
  url.searchParams.set("utm_medium", "webchat");
  url.searchParams.set("utm_campaign", "powered_by");
  return url.toString();
});
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
  transition:
    width 0.3s ease,
    height 0.3s ease;
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

/* Expanded state - desktop */
.hay-chat-window--expanded {
  width: 600px;
  height: 800px;
  max-height: calc(100vh - 120px);
}

/* Header */
.hay-chat-header {
  background: white;
  color: var(--color-neutral-900);
  padding: 14px 16px;
  border-radius: 12px 12px 0 0;
  border-bottom: 1px solid var(--color-neutral-200);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.hay-chat-header__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.hay-chat-header__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-neutral-100);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.hay-chat-header__avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hay-chat-header__avatar-fallback {
  color: var(--color-neutral-400);
}

.hay-chat-header__info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.hay-chat-header__name {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hay-chat-header__subtitle {
  font-size: 12px;
  color: var(--color-neutral-500);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hay-chat-header__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.hay-chat-header__action-btn {
  background: transparent;
  border: none;
  color: var(--color-neutral-500);
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition:
    background 0.2s,
    color 0.2s;
}

.hay-chat-header__action-btn:hover {
  background: var(--color-neutral-100);
  color: var(--color-neutral-700);
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

  /* Expanded on mobile = fullscreen */
  .hay-chat-window--expanded {
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    bottom: 0;
    right: 0;
    border-radius: 0;
  }

  .hay-chat-window--expanded.hay-chat-window--left {
    left: 0;
  }

  .hay-chat-window--expanded .hay-chat-header {
    border-radius: 0;
  }
}
</style>
