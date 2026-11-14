<template>
  <div class="hay-webchat-chat">
    <Transition name="fade">
      <ChatWindow
        v-if="isOpen"
        :title="title"
        :position="position"
        :home="view === 'home'"
        :show-back="view === 'chat'"
        :is-sheet="isSheet"
        :autofocus="!isPreview"
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
        :organization-name="organizationName"
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
        :activity="activity"
        :done-labels="doneLabels"
        :ratings="ratings"
        :read-message-id="readMessageId"
        :rate="rate"
        @close="closeChat"
        @back="goHome"
        @send="sendMessage"
        @attach="sendAttachment"
        @start-typing="startTyping"
        @stop-typing="stopTyping"
        @start-new-conversation="startOver"
        @toggle-expand="toggleExpand"
        @submit-pre-chat-form="onPreChatForm"
        @submit-in-conversation-form="submitInConversationForm"
        @product-click="trackProductClick"
      >
        <template #home>
          <HomeView
            :title="title"
            :logo-url="resolvedLogoUrl"
            :heading="homeHeading"
            :organization-name="organizationName"
            :status="availabilityStatus"
            :disclosure="aiLabel ? t('chat.aiDisclosure') : null"
            :config="config"
            :sample-conversations="preview?.conversations"
            :current-thread="currentThread"
            :assistant-name="assistantName"
            :assistant-avatar-url="resolvedAvatarUrl"
            :team="team"
            :locale="locale"
            :autofocus="!isPreview && !isSheet"
            @close="closeChat"
            @send="askFromHome"
            @attach="attachFromHome"
            @open="openFromHome"
          />
        </template>
      </ChatWindow>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, defineAsyncComponent, provide } from "vue";
import ChatWindow from "./components/ChatWindow.vue";
import { useChat, type WidgetChat, type WidgetPreview } from "./composables/useChat";
import { safeStorage } from "./composables/useConsent";
import { provideI18n, type Translations } from "./i18n";
import { resolveLocale } from "./i18n/resolve";
import { resumeConversationId } from "./utils/resume";
import { cartContextKey } from "./utils/cart";
import {
  fetchAvailability,
  headerStatus,
  waitingDetail,
  waitingTypical,
  type WidgetAvailability,
} from "./utils/availability";
import type { FormResponse } from "@hay/form-schema";
import type {
  ChallengeContribution,
  HayChatConfig,
  LauncherBridge,
  PublicConfig,
} from "./types";
import { ASSISTANT_AVATAR_PRESET } from "./components/Avatar.vue";

// The home view loads with the chat's first open (most visitors start there),
// in its own chunk so the chat chunk stays within its size budget.
const loadHomeView = () => import("./components/HomeView.vue");
const HomeView = defineAsyncComponent(loadHomeView);

// The chat window. The button lives in the loader (src/loader), which mounts
// this component once the chat chunk has loaded and hands over its button.
const props = defineProps<{
  config: HayChatConfig;
  publicConfig: PublicConfig | null;
  launcher: LauncherBridge;
  translations?: Translations;
  /** The visitor clicked the button while the chat was loading. */
  openOnMount?: boolean;
  /** Set in the dashboard's preview (C4): sample content, no network, no storage. */
  preview?: WidgetPreview;
}>();

const t = provideI18n(props.translations);
const isPreview = Boolean(props.preview);

// The page's config wins; the settings (public config) fill in the rest.
const title = computed(
  () => props.config.widgetTitle || props.publicConfig?.widgetTitle || t("widget.defaultTitle"),
);
const position = computed(() => props.config.position || props.publicConfig?.position || "right");
const showGreeting = props.config.showGreeting ?? props.publicConfig?.showGreeting ?? true;
const greetingMessage =
  props.config.greetingMessage ||
  props.publicConfig?.greetingMessage ||
  t("widget.defaultGreeting");
const homeHeading = computed(
  () => props.config.homeHeading || props.publicConfig?.homeHeading || t("home.heading"),
);
const organizationName = computed(() => props.publicConfig?.organizationName ?? null);

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

// The assistant's icon when it has no picture; every Avatar reads it.
provide(
  ASSISTANT_AVATAR_PRESET,
  computed(
    () => props.config.agentAvatarPreset || props.publicConfig?.agentAvatarPreset || "sparkle",
  ),
);

const resolvedLogoUrl = computed(() =>
  resolveUrl(
    props.config.logoUrl !== undefined ? props.config.logoUrl : props.publicConfig?.logoUrl,
  ),
);

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
  props.publicConfig?.contributions?.find(
    (c): c is ChallengeContribution => c.type === "challenge@1",
  ) ?? null;

// CSAT: host config wins, then server config; enabled by default.
const resolvedCsatEnabled = computed(
  () => props.config.csatEnabled ?? props.publicConfig?.csatEnabled ?? true,
);

const resolvedCsatQuestion = computed(
  () => props.config.csatQuestion || props.publicConfig?.csatQuestion || t("csat.defaultQuestion"),
);

const chat: WidgetChat =
  props.preview?.chat ??
  useChat(
    {
      ...props.config,
      // The greeting is pinned as the first message, so give the chat the same
      // localised default the empty state shows.
      showGreeting,
      greetingMessage,
      // Named on the "working" overlay while a page tool runs.
      agentName: resolvedAgentName.value,
    },
    {
      challenge: challengeContribution,
      preChatForm: props.publicConfig?.preChatForm ?? null,
      contributions: props.publicConfig?.contributions ?? [],
    },
  );

const {
  isOpen,
  isInitialized,
  conversationId,
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
  activity,
  doneLabels,
  ratings,
  readMessageId,
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
  rateMessage,
  openConversation,
  trackProductClick,
} = chat;

// Product cards add to the store's cart through the plugins' cart@1 contributions.
provide(cartContextKey, {
  contributions: props.publicConfig?.contributions ?? [],
  conversationId,
});

function setChallengeHost(el: HTMLElement | null) {
  challengeHost.value = el;
}

const rate = (messageId: string, rating: "up" | "down") => void rateMessage(messageId, rating);

// Phones get a full-screen sheet; the preview says which device it shows.
const sheetQuery = isPreview ? null : (window.matchMedia?.("(max-width: 480px)") ?? null);
const isSheet = ref(
  props.config.preview ? props.config.preview.device === "mobile" : (sheetQuery?.matches ?? false),
);
sheetQuery?.addEventListener?.("change", (event) => {
  isSheet.value = event.matches;
});
watch(isSheet, (sheet) => props.launcher.setSheet(sheet), { immediate: true });

// Home (question first) or the conversation. Opening the widget with a
// conversation in this tab goes straight to it; otherwise home.
const previewState = props.config.preview?.state;
const view = ref<"home" | "chat">(
  previewState === "home" || previewState === "closed" ? "home" : "chat",
);
const hasConversation = () =>
  Boolean(
    conversationId.value ||
    safeStorage.session.getItem("hay-conversation-id") ||
    resumeConversationId(),
  );

// The conversation in this tab, listed on home even before consent.
const currentThread = computed(() =>
  isPreview || !conversationId.value
    ? null
    : { id: conversationId.value, messages: messages.value, closed: isConversationClosed.value },
);

watch(isOpen, (open) => {
  if (!open || isPreview) return;
  view.value = hasConversation() ? "chat" : "home";
});

const goHome = () => {
  view.value = "home";
};

// A question asked on home starts the conversation. With a pre-chat form, the
// form comes first and the question goes once it is filled.
let queued: { text: string; file?: File } | null = null;
const askFromHome = (text: string) => {
  view.value = "chat";
  if (pendingPreChatForm.value) queued = { text };
  else void sendMessage(text);
};
const attachFromHome = (file: File, caption: string) => {
  view.value = "chat";
  if (pendingPreChatForm.value) queued = { text: caption, file };
  else void sendAttachment(file, caption);
};
const onPreChatForm = async (response: FormResponse) => {
  if (!(await submitPreChatForm(response)) || !queued) return;
  const { text, file } = queued;
  queued = null;
  if (file) void sendAttachment(file, text);
  else void sendMessage(text);
};

const openFromHome = async (id: string) => {
  if (await openConversation(id)) view.value = "chat";
};

// "Start a new conversation" on the end card goes home, ready for a question.
const startOver = () => {
  startNewConversation();
  goHome();
};

// Business hours (D5-7) and the waiting state (D5-10).
const locale = resolveLocale(props.config.locale);
const availability = ref<WidgetAvailability | null>(props.preview?.availability ?? null);
const refreshAvailability = async () => {
  if (isPreview) return;
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
watch(
  isOpen,
  (open, wasOpen) => {
    props.launcher.setOpen(open);
    if (!open && wasOpen) props.launcher.focus();
  },
  { immediate: isPreview },
);
watch(unreadCount, (count) => props.launcher.setUnread(count), { immediate: true });

onMounted(() => {
  if (isPreview) return;
  // Most visitors open on the home view: fetch it alongside.
  if (!hasConversation()) void loadHomeView();
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
