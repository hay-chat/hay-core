<template>
  <section
    ref="windowRef"
    class="hay-chat-window"
    :class="{
      'hay-chat-window--left': position === 'left',
      'hay-chat-window--expanded': isExpanded,
    }"
    role="dialog"
    :aria-label="title"
    tabindex="-1"
    @keydown.esc.stop="$emit('close')"
  >
    <!-- The home view (question first) takes the whole window -->
    <slot v-if="home" name="home"></slot>

    <template v-else>
      <header class="hay-chat-header">
        <!-- Back to the home view -->
        <button
          v-if="showBack"
          type="button"
          class="hay-chat-header__btn hay-chat-header__back"
          :aria-label="t('chat.back')"
          @click="$emit('back')"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <!-- A person who took over shows as themselves; otherwise the shop's logo -->
        <Avatar
          v-if="human"
          kind="human"
          class="hay-chat-header__avatar hay-chat-header__avatar--human"
          :name="human.name"
          :src="human.avatarUrl"
        />
        <span
          v-else
          class="hay-chat-header__avatar hay-chat-header__avatar--logo"
          aria-hidden="true"
        >
          <img v-if="logoUrl && !logoFailed" :src="logoUrl" alt="" @error="logoFailed = true" />
          <template v-else>{{ title.trim().charAt(0).toUpperCase() }}</template>
        </span>

        <div class="hay-chat-header__info">
          <span class="hay-chat-header__title">{{ human ? human.name : title }}</span>
          <span class="hay-chat-header__subtitle">
            <span
              v-if="!human"
              class="hay-chat-header__dot"
              :class="{ 'hay-chat-header__dot--away': status && !status.online }"
              aria-hidden="true"
            ></span>
            {{ human ? supportTeam : (status?.text ?? t("widget.defaultSubtitle")) }}
          </span>
        </div>

        <span
          v-if="!human && team.length"
          class="hay-chat-header__team"
          role="img"
          :aria-label="
            t('chat.teamLabel').replace('{names}', team.map((m) => m.firstName).join(', '))
          "
        >
          <Avatar
            v-for="member in team"
            :key="member.firstName"
            kind="human"
            class="hay-chat-header__team-avatar"
            :name="member.firstName"
            :src="member.avatarUrl"
          />
        </span>

        <button
          type="button"
          class="hay-chat-header__btn hay-chat-header__expand"
          :aria-label="isExpanded ? t('chat.collapse') : t('chat.expand')"
          @click="$emit('toggleExpand')"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path v-if="!isExpanded" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            <path v-else d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
          </svg>
        </button>
        <button
          type="button"
          class="hay-chat-header__btn"
          :aria-label="t('chat.close')"
          @click="$emit('close')"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      <!-- Skeleton while the chat prepares (resuming a conversation can take a moment) -->
      <div v-if="!isReady" class="hay-chat-skeleton" aria-hidden="true">
        <div class="hay-chat-skeleton__line" style="width: 62%"></div>
        <div
          class="hay-chat-skeleton__line hay-chat-skeleton__line--visitor"
          style="width: 44%"
        ></div>
        <div class="hay-chat-skeleton__line" style="width: 70%; height: 58px"></div>
      </div>

      <!-- Pre-chat form: shown before the conversation is created when configured -->
      <div v-if="pendingPreChatForm && preChatFormSchema" class="hay-chat-pre-chat">
        <PreChatForm
          :schema="preChatFormSchema"
          :context="context"
          @submit="$emit('submitPreChatForm', $event)"
        />
      </div>

      <MessageList
        v-else-if="isReady"
        :messages="messages"
        :is-typing="isTyping"
        :greeting-message="greetingMessage"
        :assistant-name="assistantName"
        :assistant-avatar-url="assistantAvatarUrl"
        :ai-label="aiLabel"
        :disclosure="aiLabel ? t('chat.aiDisclosure') : null"
        :typing-human="human"
        :locale="locale"
        :team="team"
        :activity="activity"
        :done-labels="doneLabels"
        :ratings="ratings"
        :read-message-id="readMessageId"
        :rate="rate"
        @submit-form="
          (messageId, response) => $emit('submitInConversationForm', messageId, response)
        "
      />

      <WaitingBanner
        v-if="isWaitingForHuman && !isConversationClosed && saveContactEmail"
        :typical="waitingTypical ?? null"
        :detail="waitingDetail ?? null"
        :contact-saved="contactSaved ?? false"
        :save-email="saveContactEmail"
        :visitor-message-count="visitorMessageCount"
      />

      <ChallengeFrame
        v-if="setChallengeHost"
        :interactive="challengeInteractive ?? false"
        :set-host="setChallengeHost"
      />

      <!-- End of conversation: one card in place of the composer -->
      <div v-if="isConversationClosed && !pendingPreChatForm" class="hay-chat-end">
        <span class="hay-chat-end__label">{{ t("chat.conversationEnded") }}</span>
        <CsatRating
          v-if="csatEnabled"
          :question="csatQuestion"
          :submitted="csatSubmitted"
          :submit="submitCsat"
        />
        <button type="button" class="hay-chat-end__restart" @click="$emit('startNewConversation')">
          {{ t("chat.startNew") }}
        </button>
        <PoweredBy />
      </div>

      <div v-else class="hay-chat-footer">
        <MessageInput
          v-if="!pendingPreChatForm"
          ref="inputRef"
          :is-ready="isReady"
          :failure="sendFailure"
          @send="$emit('send', $event)"
          @attach="(file, caption) => $emit('attach', file, caption)"
          @start-typing="$emit('startTyping')"
          @stop-typing="$emit('stopTyping')"
        />
        <PoweredBy />
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import MessageList from "./MessageList.vue";
import MessageInput from "./MessageInput.vue";
import WaitingBanner from "./WaitingBanner.vue";
import ChallengeFrame from "./ChallengeFrame.vue";
import CsatRating from "./CsatRating.vue";
import Avatar from "./Avatar.vue";
import PoweredBy from "./PoweredBy.vue";
import { useI18n } from "@/i18n";
import { currentHuman } from "@/utils/thread";
import type { HeaderStatus } from "@/utils/availability";
import type { AgentActivity, Message, SendFailure, TeamMember } from "@/types";
import type { FormResponse, FormSchema } from "@hay/form-schema";

// Loaded on demand: most organizations never ask for a pre-chat form.
const PreChatForm = defineAsyncComponent(() => import("./PreChatForm.vue"));

const t = useI18n();

const props = withDefaults(
  defineProps<{
    /** The shop's name for the chat, e.g. "Acme Support". */
    title: string;
    position: "left" | "right";
    /** The first AI message of a new chat; undefined shows none. */
    greetingMessage?: string;
    messages: Message[];
    isTyping: boolean;
    isReady: boolean;
    isConversationClosed: boolean;
    csatEnabled: boolean;
    csatQuestion: string;
    csatSubmitted: boolean;
    submitCsat: (rating: number) => Promise<boolean>;
    isExpanded: boolean;
    /** The AI's name on its messages. */
    assistantName: string;
    assistantAvatarUrl?: string;
    /** The shop's logo in the header; its initial on the brand colour otherwise. */
    logoUrl?: string;
    /** People who can take over, shown in the header (max 2). */
    team: TeamMember[];
    currentAgentType?: string;
    currentAgentName?: string;
    sendFailure?: SendFailure | null;
    aiLabel?: string | null;
    /** "Typically replies in ~5 min", "Back Mon 09:00"… (D5-7). */
    status?: HeaderStatus | null;
    /** The conversation waits for a person (D5-10). */
    isWaitingForHuman?: boolean;
    waitingTypical?: string | null;
    waitingDetail?: string | null;
    contactSaved?: boolean;
    saveContactEmail?: (email: string) => Promise<boolean>;
    /** Mount point for the Hay.chat security check frame (challenge@1). */
    setChallengeHost?: (el: HTMLElement | null) => void;
    /** The security check needs the shopper to interact. */
    challengeInteractive?: boolean;
    pendingPreChatForm?: boolean;
    preChatFormSchema?: FormSchema | null;
    context?: Record<string, unknown>;
    locale?: string;
    /** Show the back arrow to the home view. */
    showBack?: boolean;
    /** Show the home view (the `home` slot) instead of the conversation. */
    home?: boolean;
    /** A full-screen sheet (phones, or the mobile preview). */
    isSheet?: boolean;
    /** Move focus into the chat when it opens; off in the dashboard preview. */
    autofocus?: boolean;
    /** "Support team · {name}" while a person has taken over. */
    organizationName?: string | null;
    /** The AI's progress line and done labels, thumbs, "Seen" (C3). */
    activity?: AgentActivity | null;
    doneLabels?: Record<string, string>;
    ratings?: Record<string, "up" | "down">;
    readMessageId?: string | null;
    rate?: (messageId: string, rating: "up" | "down") => void;
  }>(),
  { autofocus: true },
);

defineEmits<{
  close: [];
  back: [];
  send: [message: string];
  attach: [file: File, caption: string];
  startTyping: [];
  stopTyping: [];
  startNewConversation: [];
  toggleExpand: [];
  submitPreChatForm: [response: FormResponse];
  submitInConversationForm: [messageId: string, response: FormResponse];
}>();

const windowRef = ref<HTMLElement | null>(null);
const inputRef = ref<InstanceType<typeof MessageInput> | null>(null);
const logoFailed = ref(false);

const human = computed(() => {
  const person = currentHuman(props.messages, props.currentAgentType, props.currentAgentName);
  if (!person) return null;
  // Their photo from the message, else from the team in the settings.
  const teamPhoto = props.team.find((member) => member.firstName === person.name)?.avatarUrl;
  return { ...person, avatarUrl: person.avatarUrl ?? teamPhoto ?? null };
});

const supportTeam = computed(() =>
  props.organizationName
    ? `${t("chat.supportTeam")} · ${props.organizationName}`
    : t("chat.supportTeam"),
);

const visitorMessageCount = computed(
  () => props.messages.filter((message) => message.sender === "user").length,
);

// Phones get a full-screen sheet: the page behind it must not scroll.
let restoreScroll: (() => void) | null = null;

// Focus moves into the chat: the message field on desktop, the window on
// phones (focusing the field would pop the keyboard over the conversation).
const focusChat = () => {
  if (!props.autofocus) return;
  void nextTick(() => {
    if (!props.isSheet && inputRef.value) inputRef.value.focus();
    else windowRef.value?.focus({ preventScroll: true });
  });
};

// From the home view into a conversation.
watch(
  () => props.home,
  (home) => {
    if (!home) focusChat();
  },
);

onMounted(() => {
  if (props.isSheet) {
    const { documentElement: html, body } = document;
    const before = [html.style.overflow, body.style.overflow];
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    restoreScroll = () => {
      [html.style.overflow, body.style.overflow] = before;
    };
  }
  // The home view focuses its own message box.
  if (props.home) {
    if (props.isSheet && props.autofocus) windowRef.value?.focus({ preventScroll: true });
  } else {
    focusChat();
  }
});

onBeforeUnmount(() => restoreScroll?.());
</script>

<style>
.hay-chat-window {
  position: fixed;
  bottom: 92px;
  right: 20px;
  width: 380px;
  height: 640px;
  max-height: calc(100vh - 112px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--hay-surface);
  color: var(--hay-text);
  border: 1px solid var(--hay-line);
  border-radius: 18px;
  box-shadow: 0 16px 48px rgba(15, 23, 42, 0.18);
  z-index: 999999;
  animation: hay-window-in 0.25s ease-out;
  transition:
    width 0.3s ease,
    height 0.3s ease;
}

/* The dashboard preview re-renders on every settings change: no entrance. */
#hay-webchat-root[data-preview] .hay-chat-window {
  animation: none;
}

#hay-webchat-root .hay-chat-window:focus-visible {
  outline: none;
}

@keyframes hay-window-in {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
}

.hay-chat-window--left {
  left: 20px;
  right: auto;
}

.hay-chat-window--expanded {
  width: 600px;
  height: 800px;
}

/* Header: filled with the brand colour */
.hay-chat-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 10px 14px 14px;
  background: var(--hay-brand);
  color: var(--hay-on-brand);
}

.hay-chat-header:has(.hay-chat-header__back) {
  padding-left: 8px;
}

.hay-chat-header__btn {
  flex: none;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
}

.hay-chat-header__back {
  width: 30px;
}

.hay-chat-header__btn:hover {
  background: color-mix(in srgb, currentColor 14%, transparent);
}

#hay-webchat-root .hay-chat-header :focus-visible {
  outline-color: var(--hay-on-brand);
}

.hay-chat-header__avatar {
  flex: none;
  width: 38px;
  height: 38px;
  font-size: 16px;
  font-weight: 700;
}

.hay-chat-header__avatar--logo {
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 11px;
  background: var(--hay-on-brand);
  color: var(--hay-brand);
}

.hay-chat-header__avatar--logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #ffffff;
}

/* People on the brand colour keep light avatars in both themes. */
.hay-chat-header .hay-chat-header__avatar--human,
.hay-chat-header .hay-chat-header__team-avatar {
  background: #fde7d6;
  color: #9a3412;
}

.hay-chat-header__avatar--human {
  font-size: 15px;
}

.hay-chat-header__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.hay-chat-header__title {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hay-chat-header__subtitle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hay-chat-header__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--hay-online);
  box-shadow: 0 0 0 2px var(--hay-brand);
}

.hay-chat-header__dot--away {
  background: color-mix(in srgb, var(--hay-on-brand) 55%, transparent);
}

.hay-chat-header__team {
  flex: none;
  display: flex;
}

.hay-chat-header__team-avatar {
  width: 26px;
  height: 26px;
  font-size: 11px;
  border: 2px solid var(--hay-brand);
}

.hay-chat-header .hay-chat-header__team-avatar + .hay-chat-header__team-avatar {
  margin-left: -8px;
  background: #dbeafe;
  color: #1e3a8a;
}

/* Skeleton while the conversation loads */
.hay-chat-skeleton {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 14px 12px;
}

.hay-chat-skeleton__line {
  height: 38px;
  border-radius: 16px 16px 16px 6px;
  background: var(--hay-bubble);
  animation: hay-skeleton 1.2s ease-in-out infinite;
}

.hay-chat-skeleton__line--visitor {
  align-self: flex-end;
  border-radius: 16px 16px 6px 16px;
}

@keyframes hay-skeleton {
  50% {
    opacity: 0.5;
  }
}

.hay-chat-pre-chat {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

/* Composer and "Powered by" */
.hay-chat-footer {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 12px 10px;
}

/* End of conversation */
.hay-chat-end {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 10px;
  border-top: 1px solid var(--hay-line);
  background: var(--hay-raised);
}

.hay-chat-end__label {
  font-size: 12px;
  color: var(--hay-meta);
}

.hay-chat-end__restart {
  width: 100%;
  margin-top: 4px;
  padding: 10px 16px;
  border: 1px solid var(--hay-line);
  border-radius: 12px;
  background: var(--hay-surface);
  color: var(--hay-text);
  font-weight: 500;
}

.hay-chat-end__restart:hover {
  border-color: var(--hay-meta);
}

/* Phones (and the mobile preview): a full-screen sheet; the button hides while it is open */
#hay-webchat-root[data-sheet] .hay-chat-window {
  inset: 0;
  width: 100%;
  height: 100%;
  max-height: none;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  z-index: 1000000;
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}

#hay-webchat-root[data-sheet] .hay-chat-header {
  padding: calc(18px + env(safe-area-inset-top, 0px)) 12px 14px 14px;
}

#hay-webchat-root[data-sheet] .hay-chat-header:has(.hay-chat-header__back) {
  padding-left: 6px;
}

#hay-webchat-root[data-sheet] .hay-chat-header__btn {
  width: 44px;
  height: 44px;
}

#hay-webchat-root[data-sheet] .hay-chat-header__expand {
  display: none;
}

#hay-webchat-root[data-sheet] .hay-chat-footer,
#hay-webchat-root[data-sheet] .hay-chat-end {
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}
</style>
