<template>
  <div
    :class="[
      'chat-message',
      `chat-message--${message.type}`,
      {
        'chat-message--inverted': inverted,
        'chat-message--has-error': message.metadata?.toolStatus === 'ERROR',
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
        <span class="chat-message__sender">{{ message.sender }}</span>
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
        <div v-else-if="message.type === 'ToolCall' && message.metadata?.toolName">
          <div class="chat-message__tool-call-title font-bold">
            <Zap class="mr-2 h-4 w-4 inline" />
            Running action &lt;{{ message.metadata?.toolName }}&gt;
          </div>
        </div>
        <div v-else-if="message.type === 'ToolResponse'">
          <div class="chat-message__tool-response-title font-bold">
            <Zap class="mr-2 h-4 w-4 inline" /><template
              v-if="message.metadata?.toolStatus === 'ERROR'"
            >
              Action failed
            </template>
            <template v-else> Action responded </template> &lt;{{ message.metadata?.toolName }}&gt;
          </div>
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
      <div v-if="message.status === MessageStatus.PENDING" class="chat-message__actions">
        <Button size="sm" variant="outline" @click="$emit('approve')">
          <Check class="h-3 w-3 mr-1" />
          Approve
        </Button>
        <Button size="sm" variant="outline" @click="$emit('edit')">
          <Edit class="h-3 w-3 mr-1" />
          Edit
        </Button>
        <Button size="sm" variant="destructive" @click="$emit('reject')">
          <X class="h-3 w-3 mr-1" />
          Reject
        </Button>
      </div>
      <div
        v-else-if="message.metadata && message.type === 'BotAgent'"
        class="chat-message__metadata"
      >
        <div v-if="message.metadata.confidence" class="chat-message__confidence">
          Confidence: {{ (message.metadata.confidence * 100).toFixed(0) }}%
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch } from "vue";
import {
  User,
  Bot,
  Paperclip,
  Check,
  Edit,
  X,
  ChevronDown,
  ChevronUp,
  FileSearch,
  ListVideo,
  Frown,
  Smile,
  Laugh,
  Zap,
  BrainCircuit,
} from "lucide-vue-next";
import Badge from "@/components/ui/Badge.vue";
import Button from "@/components/ui/Button.vue";
import { markdownToHtml } from "@/utils/markdownToHtml";
import { MessageStatus, type Message, MessageSentiment } from "@/types/message";

interface Props {
  message: Message;
  inverted?: boolean;
}

const props = defineProps<Props>();
defineEmits<{
  approve: [];
  edit: [];
  reject: [];
}>();

// System message collapse/expand logic
const systemMessageRef = ref<HTMLElement | null>(null);
const isSystemExpandable = ref(false);
const isSystemCollapsed = ref(false);
const isCollapsibleVariant = computed(() =>
  ["System", "ToolCall", "ToolResponse", "Document", "Playbook"].includes(props.message.type),
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

.chat-message--ToolCall,
.chat-message--ToolResponse {
  --bubble-bg: var(--color-purple-50);
  --bubble-fg: var(--color-purple-700);
}

.chat-message--ToolResponse.chat-message--has-error {
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
</style>
