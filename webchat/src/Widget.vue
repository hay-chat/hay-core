<template>
  <div class="hay-webchat-chat">
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
        :is-ready="isInitialized"
        :is-conversation-closed="isConversationClosed"
        :csat-enabled="resolvedCsatEnabled"
        :csat-question="resolvedCsatQuestion"
        :csat-submitted="csatSubmitted"
        :submit-csat="submitCsat"
        :is-expanded="isExpanded"
        :agent-name="resolvedAgentName"
        :agent-avatar-url="resolvedAvatarUrl"
        :organization-logo-url="resolvedLogoUrl"
        :current-agent-type="currentAgentType"
        :current-agent-name="currentAgentName || undefined"
        :send-failure="sendFailure"
        :ai-label="aiLabel"
        :availability-status="availabilityStatus"
        :is-waiting-for-human="isWaitingForHuman"
        :waiting-detail="waitingLine"
        :contact-saved="contactEmailSaved"
        :save-contact-email="saveContactEmail"
        :set-challenge-host="challengeContribution ? setChallengeHost : undefined"
        :challenge-interactive="isChallengeInteractive"
        :pending-pre-chat-form="pendingPreChatForm"
        :pre-chat-form-schema="preChatFormSchema"
        :context="config.context"
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
import { resolveWidgetSubtitle } from "./utils/subtitle";
import { resolveLocale } from "./i18n/resolve";
import { resumeConversationId } from "./utils/resume";
import {
  fetchAvailability,
  headerStatus,
  waitingDetail,
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

const widgetSubtitle = computed(() =>
  resolveWidgetSubtitle(props.config.widgetSubtitle, t("widget.defaultSubtitle")),
);

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

const resolvedLogoUrl = computed(() =>
  resolveUrl(props.config.organizationLogoUrl || props.publicConfig?.organizationLogoUrl),
);

// AI label on AI replies (D14-6): on unless the org hid it; the org's text or
// the localized default. Shown when the config could not be fetched.
const aiLabel = computed(() =>
  props.publicConfig?.aiLabelShown === false
    ? null
    : props.publicConfig?.aiLabelText || t("chat.aiLabel"),
);

const resolvedAgentName = computed(
  () => props.config.agentName || props.publicConfig?.agentName || undefined,
);

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
    showGreeting: props.config.showGreeting ?? true,
    greetingMessage: props.config.greetingMessage || t("widget.defaultGreeting"),
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
watch(isOpen, (open) => {
  if (open) void refreshAvailability();
});
watch(isWaitingForHuman, (waiting) => {
  if (waiting) void refreshAvailability();
});

// Keep the loader's button in step with the chat.
watch(isOpen, (open) => props.launcher.setOpen(open));
watch(unreadCount, (count) => props.launcher.setUnread(count), { immediate: true });

onMounted(() => {
  // A follow-up email link (D5-9) reopens its conversation.
  if (props.openOnMount || resumeConversationId()) openChat();
  else resumeActiveConversation();
});

defineExpose({ toggle: toggleChat });
</script>

<style>
/* Global styles for the widget */
.hay-webchat-chat {
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.hay-webchat-chat * {
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
