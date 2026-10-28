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
        @close="closeChat"
        @send="sendMessage"
        @start-typing="startTyping"
        @stop-typing="stopTyping"
        @start-new-conversation="startNewConversation"
        @toggle-expand="toggleExpand"
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

const {
  isOpen,
  isInitialized,
  messages,
  isTyping,
  unreadCount,
  isConversationClosed,
  currentAgentType,
  currentAgentName,
  conversationStatus,
  contactEmailSaved,
  sendFailure,
  toggleChat,
  openChat,
  closeChat,
  sendMessage,
  startTyping,
  stopTyping,
  startNewConversation,
  resumeActiveConversation,
  saveContactEmail,
} = useChat({
  ...props.config,
  // The greeting is pinned as the first message, so give the chat the same
  // localised default the empty state shows.
  showGreeting: props.config.showGreeting ?? true,
  greetingMessage: props.config.greetingMessage || t("widget.defaultGreeting"),
});

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
