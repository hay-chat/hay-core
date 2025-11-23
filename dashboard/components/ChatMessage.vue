<template>
  <div
    :class="[
      'chat-message',
      `chat-message--${message.type}`,
      {
        'chat-message--inverted': inverted,
        'chat-message--has-error': message.metadata?.toolStatus === 'ERROR',
        'chat-message--pending': message.deliveryState === 'pending',
        'chat-message--failed': message.deliveryState === 'failed',
      },
      '',
    ]"
  >
    <div v-if="message.type !== 'System'" class="chat-message__avatar">
      <component :is="avatarIcon" class="chat-message__avatar-icon" />
    </div>
    <div class="chat-message__content">
      <div
        v-if="
          message.type == 'BotAgent' || message.type == 'HumanAgent' || message.type == 'Customer'
        "
        class="chat-message__header"
      >
        <div v-if="isQueued && showApproval" class="mb-2 flex-1">
          <Badge variant="outline" class="text-xs">
            <Clock class="h-3 w-3 mr-1" />
            Queued for Approval
          </Badge>
        </div>

        <span v-else class="chat-message__sender">{{ message.sender }}</span>
        <span class="chat-message__time">{{ formattedTime }}</span>
        <div v-if="message.metadata?.isPlaybook" class="chat-message__playbook-badge">
          <Badge variant="outline" class="text-xs">
            <Zap class="h-2 w-2 mr-1" />
            Playbook
          </Badge>
        </div>
      </div>
      <div
        :class="[
          'chat-message__bubble',
          {
            'chat-message__bubble--needs-approval': message.status === MessageStatus.PENDING,
            'chat-message__bubble--collapsed': isCollapsibleVariant && isSystemCollapsed,
            'chat-message__bubble--expanded':
              isCollapsibleVariant && !isSystemCollapsed && isSystemExpandable,
            'chat-message__bubble--pending': message.deliveryState === 'pending',
            'chat-message__bubble--failed': message.deliveryState === 'failed',
          },
        ]"
      >
        <div v-if="message.type === 'Playbook'">
          <div class="chat-message__document-title font-bold">
            <ListVideo class="mr-2 h-4 w-4 inline" /> Agent is now following a playbook
          </div>
          <a
            class="chat-message__document-title text-xs opacity-70 mt-2"
            :href="`/playbooks/${message.metadata?.playbookId}`"
          >
            {{ message.metadata?.playbookTitle }}
          </a>
        </div>
        <div v-else-if="message.type === 'Document'">
          <div class="chat-message__document-title font-bold">
            <FileSearch class="mr-2 h-4 w-4 inline" /> Agent is using a document to provide the
            answer
          </div>
          <a
            class="chat-message__document-title text-xs opacity-70 mt-2"
            :href="`/documents/${message.metadata?.documentId}`"
          >
            {{ message.metadata?.documentTitle }}
          </a>
        </div>
        <div v-else-if="message.type === 'Tool'">
          <ToolExecutionViewer
            :tool-name="message.metadata?.toolName"
            :tool-input="message.metadata?.toolInput"
            :tool-output="message.metadata?.toolOutput"
            :tool-status="message.metadata?.toolStatus"
            :http-status="message.metadata?.httpStatus"
            :latency="message.metadata?.toolLatencyMs"
            :executed-at="message.metadata?.toolExecutedAt"
          />
        </div>
        <div v-else-if="message.type === 'System'">
          <div class="chat-message__system-title font-bold">
            <BrainCircuit class="mr-2 h-4 w-4 inline" /> Agent is following system instructions
          </div>
          <div
            ref="systemMessageRef"
            class="chat-message__system-content chat-message__text"
            v-html="markdownToHtml(message.content)"
          />
        </div>
        <div
          v-else
          ref="systemMessageRef"
          class="chat-message__text"
          v-html="markdownToHtml(message.content)"
        />
      </div>
      <div
        v-if="isCollapsibleVariant && isSystemExpandable"
        class="chat-message__expand-button"
        @click="toggleSystemExpanded"
      >
        <ChevronDown v-if="isSystemCollapsed" class="h-3 w-3" />
        <ChevronUp v-else class="h-3 w-3" />
        {{ isSystemCollapsed ? "Expand" : "Collapse" }}
      </div>

      <!-- Pending/Failed Message States -->
      <div v-if="message.deliveryState === 'pending'" class="chat-message__status">
        <div class="flex items-center gap-1 text-xs text-neutral-muted">
          <Clock class="h-3 w-3 animate-pulse" />
          <span>Sending...</span>
        </div>
      </div>
      <div v-else-if="message.deliveryState === 'failed'" class="chat-message__status">
        <div class="flex items-center gap-2 text-xs text-red-600">
          <AlertCircle class="h-3 w-3" />
          <span>{{ message.errorMessage || "Failed to send" }}</span>
          <Button
            size="sm"
            variant="ghost"
            class="h-6 px-2 text-xs hover:bg-red-50"
            @click="handleRetryClick"
          >
            <RotateCcw class="h-3 w-3 mr-1" />
            Retry
          </Button>
        </div>
      </div>

      <div v-if="message.attachments?.length" class="chat-message__attachments">
        <div
          v-for="attachment in message.attachments"
          :key="attachment.id"
          class="chat-message__attachment"
        >
          <Paperclip class="chat-message__attachment-icon" />
          <span>{{ attachment.name }}</span>
        </div>
      </div>
      <!-- Queued Message Actions (Test Mode) -->
      <div v-if="isQueued && showApproval" class="chat-message__actions">
        <div class="flex gap-2 mt-2 mb-4">
          <Button size="sm" variant="success" @click="handleApproveClick">
            <Check class="h-3 w-3 mr-1" />
            Approve & Send
          </Button>
          <Button size="sm" variant="destructive" @click="handleBlockClick">
            <Ban class="h-3 w-3 mr-1" />
            Block
          </Button>
        </div>
      </div>

      <!-- Sent Message Metadata & Feedback -->
      <div v-else-if="message.type === 'BotAgent' && !isQueued" class="chat-message__metadata">
        <div class="flex items-center gap-3 mt-1">
          <div v-if="message.metadata?.confidence" class="chat-message__confidence-detailed">
            <Badge
              :variant="getConfidenceBadgeVariant(message.metadata.confidenceTier)"
              class="text-xs"
            >
              {{ getConfidenceIcon(message.metadata.confidenceTier) }}
              {{ (message.metadata.confidence * 100).toFixed(0) }}% Confidence
              <span v-if="message.metadata.recheckAttempted" class="ml-1" title="Rechecked">↻</span>
            </Badge>
          </div>
          <MessageFeedbackControl
            v-if="showFeedback"
            :message-id="message.id"
            @feedback-submitted="handleFeedbackSubmitted"
          />
        </div>
      </div>
    </div>

    <!-- Approval Dialog -->
    <MessageApprovalDialog
      v-model:open="showApprovalDialog"
      :message-id="message.id"
      :original-content="message.content"
      @approved="handleMessageApproved"
      @blocked="handleMessageBlocked"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch } from "vue";
import {
  User,
  Bot,
  Paperclip,
  Check,
  ChevronDown,
  ChevronUp,
  FileSearch,
  ListVideo,
  Frown,
  Smile,
  Laugh,
  Zap,
  BrainCircuit,
  Clock,
  Ban,
  AlertCircle,
  RotateCcw,
} from "lucide-vue-next";
import { markdownToHtml } from "@/utils/markdownToHtml";
import { MessageStatus, type Message, MessageSentiment } from "@/types/message";

interface Props {
  message: Message;
  inverted?: boolean;
  showFeedback?: boolean;
  showApproval?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showFeedback: false,
  showApproval: false,
});

const emit = defineEmits<{
  approve: [];
  edit: [];
  reject: [];
  feedbackSubmitted: [];
  messageApproved: [messageId: string];
  messageBlocked: [messageId: string];
  retry: [messageId: string];
}>();

// Approval dialog state
const showApprovalDialog = ref(false);

// Check if message is queued (delivery_state = 'queued')
const isQueued = computed(() => {
  return (
    (props.message as any).deliveryState === "queued" ||
    (props.message as any).delivery_state === "queued"
  );
});

const handleApproveClick = () => {
  showApprovalDialog.value = true;
};

const handleBlockClick = () => {
  showApprovalDialog.value = true;
};

const handleMessageApproved = (messageId: string) => {
  emit("messageApproved", messageId);
};

const handleMessageBlocked = (messageId: string) => {
  emit("messageBlocked", messageId);
};

const handleFeedbackSubmitted = () => {
  emit("feedbackSubmitted");
};

const handleRetryClick = () => {
  emit("retry", props.message.id);
};

// System message collapse/expand logic
const systemMessageRef = ref<HTMLElement | null>(null);
const isSystemExpandable = ref(false);
const isSystemCollapsed = ref(false);
const isCollapsibleVariant = computed(() =>
  ["System", "Tool", "Document", "Playbook"].includes(props.message.type),
);

const checkSystemMessageHeight = async () => {
  if (isCollapsibleVariant.value && systemMessageRef.value) {
    await nextTick();
    const element = systemMessageRef.value;

    // Use offsetHeight which gives the actual rendered height
    const height = element.offsetHeight;
    // Convert 10rem to pixels (assuming 1rem = 16px)
    const tenRemInPixels = 10 * 16;

    isSystemExpandable.value = height > tenRemInPixels;
    if (isSystemExpandable.value) {
      isSystemCollapsed.value = true;
    }
  }
};

const toggleSystemExpanded = () => {
  isSystemCollapsed.value = !isSystemCollapsed.value;
};

onMounted(() => {
  checkSystemMessageHeight();
});

// Also check when content changes
watch(
  () => props.message.content,
  () => {
    if (isCollapsibleVariant.value) {
      nextTick(() => checkSystemMessageHeight());
    }
  },
);

const formattedTime = computed(() => {
  const date = new Date(props.message.created_at);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
});

const avatarIcon = computed(() => {
  if (props.message.type === "Customer") {
    const sentimentIcon = {
      positive: Laugh,
      negative: Frown,
      neutral: Smile,
    };
    return sentimentIcon[props.message.sentiment as MessageSentiment] || User;
  }

  if (props.message.type === "BotAgent" || props.message.type === "HumanAgent") return Bot;
  return User;
});

// Confidence display helpers
const getConfidenceBadgeVariant = (tier: string | undefined) => {
  if (!tier) return "secondary";
  switch (tier) {
    case "high":
      return "success";
    case "medium":
      return "warning";
    case "low":
      return "destructive";
    default:
      return "secondary";
  }
};

const getConfidenceIcon = (tier: string | undefined) => {
  if (!tier) return "";
  switch (tier) {
    case "high":
      return "✓";
    case "medium":
      return "⚡";
    case "low":
      return "⚠";
    default:
      return "";
  }
};
</script>

<style lang="scss">
/* Base message container */

.chat-message {
  display: flex;
  font-size: 0.875rem;
  justify-content: flex-start;
  flex-direction: row-reverse;
  gap: 0.5rem;
  --bubble-bg: var(--color-blue-700);
  --bubble-fg: var(--color-white);
}

.chat-message__system-content {
  font-size: 0.75rem;
  margin-top: 0.5rem;
}

.chat-message--Customer {
  flex-direction: row;
}

.chat-message--inverted {
  flex-direction: row;
}
.chat-message--inverted.chat-message--Customer {
  flex-direction: row-reverse;
}

.chat-message__header {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  flex-direction: inherit;
}

.chat-message--Customer .chat-message__header {
  justify-content: flex-start;
}

.chat-message--no-header,
.chat-message--System {
  margin-inline: 2.5rem;
}

.chat-message__content {
  position: relative;
  max-width: 60ch;
}

.chat-message__bubble {
  border-radius: var(--border-radius-md);
  overflow: hidden;
  background-color: var(--bubble-bg);
  color: var(--bubble-fg);
  padding: 0.5rem 1rem;
}

.chat-message__bubble--collapsed {
  max-height: 10rem;
  overflow: hidden;
  position: relative;
  &::after {
    content: "";
    height: 4rem;
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(to bottom, transparent, var(--bubble-bg));
  }
}

.chat-message__bubble--expanded {
  max-height: none;
  overflow: visible;
}

.chat-message__bubble--expanded::after {
  display: none;
}

.chat-message__bubble--needs-approval {
  position: relative;
  animation: approval-pulse 2s ease-in-out infinite;
  border: 1px dashed var(--color-neutral-400);
  --bubble-bg: var(--color-neutral-100);
  --bubble-fg: var(--color-neutral-800);
}

@keyframes approval-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-neutral-600) 50%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0.5rem color-mix(in srgb, var(--color-neutral-600) 0%, transparent);
  }
}

/* Pending state - semi-transparent */
.chat-message--pending {
  opacity: 0.6;
}

.chat-message__bubble--pending {
  position: relative;
}

/* Failed state - error styling */
.chat-message--failed {
  opacity: 1;
}

.chat-message__bubble--failed {
  border: 1px solid var(--color-red-500);
  background-color: color-mix(in srgb, var(--color-red-50) 50%, var(--bubble-bg));
}

.chat-message__status {
  margin-top: 0.25rem;
  padding: 0.25rem 0;
}

.chat-message__expand-button {
  padding: 0.5rem;
  font-size: 0.75rem;
  cursor: pointer;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

/* Theme Variations */
.chat-message--Customer {
  --bubble-bg: var(--color-neutral-100);
  --bubble-fg: var(--color-neutral);
}

.chat-message--HumanAgent {
  --bubble-bg: var(--color-green-600);
  --bubble-fg: var(--color-white);
}

.chat-message--System {
  --bubble-bg: #ecf3fe;
  --bubble-fg: var(--foreground);
}

.chat-message--Document {
  --bubble-bg: var(--color-document-100);
  --bubble-fg: var(--color-document-600);
}

.chat-message--Playbook {
  --bubble-bg: var(--color-green-100);
  --bubble-fg: var(--color-green-700);
}

.chat-message--Tool {
  --bubble-bg: var(--color-purple-50);
  --bubble-fg: var(--color-purple-700);
}

.chat-message--Tool.chat-message--has-error {
  --bubble-bg: var(--color-red-50);
  --bubble-fg: var(--color-red-700);
}

/* Avatar */
.chat-message__avatar {
  min-width: 2rem;
  min-height: 2rem;
  max-width: 2rem;
  max-height: 2rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;

  svg {
    height: 1em;
    width: 1em;
  }
}

.chat-message--Customer .chat-message__avatar {
  background-color: var(--bubble-bg);
  color: var(--bubble-fg);
}

.chat-message--BotAgent .chat-message__avatar {
  @apply bg-blue-100 text-blue-600;
}

.chat-message__sender {
  font-weight: bold;
  margin-right: 0.5rem;
}

.chat-message__time {
  font-size: 0.75rem;
  color: var(--color-neutral-muted);
}

.chat-message {
  a {
    text-decoration: underline;
  }
}
</style>
