<template>
  <div class="hay-webchat-chat">
    <Transition name="fade">
      <ChatWindow
        v-if="isOpen"
        :title="title"
        :position="config.position || publicConfig?.position || 'right'"
        :greeting-message="showGreeting ? greetingMessage : undefined"
        :messages="messages"
        :is-typing="isTyping"
        :is-ready="isInitialized"
        :is-conversation-closed="isConversationClosed"
        :csat-enabled="resolvedCsatEnabled"
        :csat-question="resolvedCsatQuestion"
        :csat-submitted="csatSubmitted"
        :submit-csat="submitCsat"
        :is-expanded="isExpanded"
        :assistant-name="assistantName"
        :assistant-avatar-url="resolvedAvatarUrl"
        :logo-url="resolvedLogoUrl"
        :team="team"
        :current-agent-type="currentAgentType"
        :current-agent-name="currentAgentName || undefined"
        :send-failure="sendFailure"
        :ai-label="aiLabel"
        :status="availabilityStatus"
        :is-waiting-for-human="isWaitingForHuman"
        :waiting-typical="waitingTypicalLine"
        :waiting-detail="waitingLine"
        :contact-saved="contactEmailSaved"
        :save-contact-email="saveContactEmail"
        :set-challenge-host="challengeContribution ? setChallengeHost : undefined"
        :challenge-interactive="isChallengeInteractive"
        :pending-pre-chat-form="pendingPreChatForm"
        :pre-chat-form-schema="preChatFormSchema"
        :context="config.context"
        :locale="locale"
        @close="closeChat"
        @send="sendMessage"
        @attach="sendAttachment"
        @start-typing="startTyping"
        @stop-typing="stopTyping"
        @start-new-conversation="startNewConversation"
        @toggle-expand="toggleExpand"
        @submit-pre-chat-form="submitPreChatForm"
        @submit-in-conversation-form="submitInConversationForm"
      />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import ChatWindow from "./components/ChatWindow.vue";
import { useChat } from "./composables/useChat";
import { provideI18n, type Translations } from "./i18n";
import { resolveLocale } from "./i18n/resolve";
import { resumeConversationId } from "./utils/resume";
import {
  fetchAvailability,
  headerStatus,
  waitingDetail,
  waitingTypical,
  type WidgetAvailability,
} from "./utils/availability";
import type { HayChatConfig, LauncherBridge, PublicConfig } from "./types";

// The chat window. The button lives in the loader (src/loader), which mounts
// this component once the chat chunk has loaded and hands over its button.
const props = defineProps<{
  config: HayChatConfig;
  publicConfig: PublicConfig | null;
  launcher: LauncherBridge;
  translations?: Translations;
  /** The visitor clicked the button while the chat was loading. */
  openOnMount?: boolean;
}>();

const t = provideI18n(props.translations);

// The page's config wins; the settings (public config) fill in the rest.
const title = computed(
  () => props.config.widgetTitle || props.publicConfig?.widgetTitle || t("widget.defaultTitle"),
);
const showGreeting = props.config.showGreeting ?? props.publicConfig?.showGreeting ?? true;
const greetingMessage =
  props.config.greetingMessage ||
  props.publicConfig?.greetingMessage ||
  t("widget.defaultGreeting");

const isExpanded = ref(false);

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value;
};

// Resolve a relative image URL to absolute using baseUrl
const resolveUrl = (url: string | undefined | null): string | undefined => {
  if (!url) return undefined;
  if (url.startsWith("http")) return url;
  return `${props.config.baseUrl}${url}`;
};

// Host-provided config takes priority, fetched config fills in gaps
const resolvedAvatarUrl = computed(() =>
  resolveUrl(props.config.agentAvatarUrl || props.publicConfig?.agentAvatarUrl),
);

const resolvedLogoUrl = computed(() => resolveUrl(props.publicConfig?.logoUrl));

// People who can take over (only sent when handoff is on), shown in the header.
const team = computed(() =>
  (props.publicConfig?.team ?? []).slice(0, 2).map((member) => ({
    firstName: member.firstName,
    avatarUrl: resolveUrl(member.avatarUrl) ?? null,
  })),
);

// AI label after the assistant's name (D14-6): on unless the org hid it; the
// org's text or the localized default. Shown when the config could not be fetched.
const aiLabel = computed(() =>
  props.publicConfig?.aiLabelShown === false
    ? null
    : props.publicConfig?.aiLabelText || t("chat.aiLabel"),
);

const resolvedAgentName = computed(
  () => props.config.agentName || props.publicConfig?.agentName || undefined,
);
const assistantName = computed(() => resolvedAgentName.value || t("chat.assistant"));

// The org's bot check, when one is on (declarative challenge@1 contribution).
const challengeContribution =
  props.publicConfig?.contributions?.find((c) => c.type === "challenge@1") ?? null;

// CSAT: host config wins, then server config; enabled by default.
const resolvedCsatEnabled = computed(
  () => props.config.csatEnabled ?? props.publicConfig?.csatEnabled ?? true,
);

const resolvedCsatQuestion = computed(
  () => props.config.csatQuestion || props.publicConfig?.csatQuestion || t("csat.defaultQuestion"),
);

const {
  isOpen,
  isInitialized,
  messages,
  isTyping,
  unreadCount,
  isConversationClosed,
  csatSubmitted,
  currentAgentType,
  currentAgentName,
  conversationStatus,
  contactEmailSaved,
  sendFailure,
  challengeHost,
  isChallengeInteractive,
  pendingPreChatForm,
  preChatFormSchema,
  toggleChat,
  openChat,
  closeChat,
  sendMessage,
  sendAttachment,
  submitCsat,
  startTyping,
  stopTyping,
  startNewConversation,
  resumeActiveConversation,
  saveContactEmail,
  submitPreChatForm,
  submitInConversationForm,
} = useChat(
  {
    ...props.config,
    // The greeting is pinned as the first message, so give the chat the same
    // localised default the empty state shows.
    showGreeting,
    greetingMessage,
    // Named on the "working" overlay while a page tool runs.
    agentName: resolvedAgentName.value,
  },
  { challenge: challengeContribution, preChatForm: props.publicConfig?.preChatForm ?? null },
);

function setChallengeHost(el: HTMLElement | null) {
  challengeHost.value = el;
}

// Business hours (D5-7) and the waiting state (D5-10).
const locale = resolveLocale(props.config.locale);
const availability = ref<WidgetAvailability | null>(null);
const refreshAvailability = async () => {
  availability.value = await fetchAvailability(props.config);
};
const availabilityStatus = computed(() => headerStatus(availability.value, t, locale));
const isWaitingForHuman = computed(
  () => conversationStatus.value === "pending-human" && currentAgentType.value !== "HumanAgent",
);
const waitingLine = computed(() => waitingDetail(availability.value, t, locale));
const waitingTypicalLine = computed(() => waitingTypical(availability.value, t));
watch(isOpen, (open) => {
  if (open) void refreshAvailability();
});
watch(isWaitingForHuman, (waiting) => {
  if (waiting) void refreshAvailability();
});

// Keep the loader's button in step with the chat; focus goes back to it on close.
watch(isOpen, (open, wasOpen) => {
  props.launcher.setOpen(open);
  if (!open && wasOpen) props.launcher.focus();
});
watch(unreadCount, (count) => props.launcher.setUnread(count), { immediate: true });

onMounted(() => {
  // A follow-up email link (D5-9) reopens its conversation.
  if (props.openOnMount || resumeConversationId()) openChat();
  else resumeActiveConversation();
});

defineExpose({ toggle: toggleChat });
</script>

<style>
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
