<template>
  <div
    :class="[
      'chat-message',
      `chat-message--${variant}`,
      {
        'chat-message--inverted': inverted,
        'chat-message--no-header': showHeader === false,
      },
    ]"
  >
    <div
      v-if="showHeader !== false && variant !== 'system'"
      class="chat-message__avatar"
    >
      <component :is="avatarIcon" class="chat-message__avatar-icon" />
    </div>
    <div class="chat-message__content">
      <div v-if="showHeader !== false" class="chat-message__header">
        <span
          v-if="senderName && variant !== 'system'"
          class="chat-message__sender"
          >{{ senderName }}</span
        >
        <span v-if="variant !== 'system'" class="chat-message__time">{{
          formattedTime
        }}</span>
        <div v-if="metadata?.isPlaybook" class="chat-message__playbook-badge">
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
            'chat-message__bubble--needs-approval': metadata?.needsApproval,
          },
        ]"
      >
        <div class="chat-message__text" v-html="markdownToHtml(content)"></div>
        <div v-if="attachments?.length" class="chat-message__attachments">
          <div
            v-for="attachment in attachments"
            :key="attachment.id"
            class="chat-message__attachment"
          >
            <Paperclip class="chat-message__attachment-icon" />
            <span>{{ attachment.name }}</span>
          </div>
        </div>
        <div v-if="metadata?.needsApproval" class="chat-message__actions">
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
          v-else-if="metadata && variant === 'agent'"
          class="chat-message__metadata"
        >
          <div v-if="metadata.tool" class="chat-message__tool">
            <Wrench class="chat-message__tool-icon" />
            <span>Used: {{ metadata.tool }}</span>
          </div>
          <div v-if="metadata.confidence" class="chat-message__confidence">
            Confidence: {{ (metadata.confidence * 100).toFixed(0) }}%
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  User,
  Bot,
  Info,
  Paperclip,
  Wrench,
  Zap,
  Check,
  Edit,
  X,
  PhoneCall,
  PhoneOff,
  Users,
  UserPlus,
  UserMinus,
  ArrowRightLeft,
} from "lucide-vue-next";
import Badge from "@/components/ui/Badge.vue";
import Button from "@/components/ui/Button.vue";
import { markdownToHtml } from "@/utils/markdownToHtml";
interface Attachment {
  id: string;
  name: string;
}

interface Metadata {
  tool?: string;
  confidence?: number;
  isPlaybook?: boolean;
  needsApproval?: boolean;
  action?: string;
  [key: string]: any;
}

interface Props {
  variant: "customer" | "agent" | "system";
  content: string;
  timestamp: string | Date;
  senderName?: string;
  attachments?: Attachment[];
  metadata?: Metadata;
  inverted?: boolean;
  showHeader?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  approve: [];
  edit: [];
  reject: [];
}>();

const formattedTime = computed(() => {
  const date = new Date(props.timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
});

const avatarIcon = computed(() => {
  if (props.variant === "customer") return User;
  if (props.variant === "agent") return Bot;

  // System message icons
  const action = props.metadata?.action;
  switch (action) {
    case "call_started":
      return PhoneCall;
    case "call_ended":
      return PhoneOff;
    case "joined":
      return UserPlus;
    case "left":
      return UserMinus;
    case "transferred":
      return ArrowRightLeft;
    case "escalated":
      return Users;
    default:
      return Info;
  }
});
</script>

<style scoped lang="scss">
/* Base message container */
.chat-message {
  @apply flex gap-3 max-w-2xl mb-4;
}

/* Variant-specific positioning */
.chat-message--customer {
  @apply mr-auto;
}

.chat-message--agent {
  @apply ml-auto flex-row-reverse;
}

/* Inverted mode (for playground where user is the customer) */
.chat-message--inverted.chat-message--customer {
  @apply ml-auto flex-row-reverse mr-0;
}

.chat-message--inverted.chat-message--agent {
  @apply mr-auto flex-row ml-0;
}

.chat-message--system {
  @apply justify-center mx-auto my-4;
}

/* Avatar styles */
.chat-message__avatar {
  @apply w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0;
}

/* No header state - add left padding to align with messages that have avatars */
.chat-message--no-header:not(.chat-message--system) .chat-message__content {
  @apply ml-11; /* 8 (avatar width) + 3 (gap) = 11 */
}

.chat-message--no-header.chat-message--agent .chat-message__content {
  @apply mr-11 ml-0; /* Reverse for agent messages */
}

.chat-message--no-header.chat-message--inverted.chat-message--customer
  .chat-message__content {
  @apply mr-11 ml-0; /* Reverse for inverted customer messages */
}

.chat-message--no-header.chat-message--inverted.chat-message--agent
  .chat-message__content {
  @apply ml-11 mr-0; /* Normal for inverted agent messages */
}

.chat-message--customer .chat-message__avatar {
  @apply bg-primary/10;
}

.chat-message--agent .chat-message__avatar {
  @apply bg-blue-100;
}

/* Inverted avatar colors */
.chat-message--inverted.chat-message--customer .chat-message__avatar {
  @apply bg-blue-100;
}

.chat-message--inverted.chat-message--agent .chat-message__avatar {
  @apply bg-primary/10;
}

.chat-message--system .chat-message__avatar {
  @apply w-5 h-5 bg-transparent;
}

.chat-message__avatar-icon {
  @apply w-4 h-4;
}

.chat-message--customer .chat-message__avatar-icon {
  @apply text-primary;
}

.chat-message--agent .chat-message__avatar-icon {
  @apply text-blue-600;
}

/* Inverted avatar icon colors */
.chat-message--inverted.chat-message--customer .chat-message__avatar-icon {
  @apply text-blue-600;
}

.chat-message--inverted.chat-message--agent .chat-message__avatar-icon {
  @apply text-primary;
}

.chat-message--system .chat-message__avatar-icon {
  @apply w-3 h-3 text-muted-foreground;
}

/* Content container */
.chat-message__content {
  @apply flex-1 min-w-0;
}

.chat-message--agent .chat-message__content {
  @apply text-right;
}

/* Inverted content alignment */
.chat-message--inverted.chat-message--customer .chat-message__content {
  @apply text-right;
}

.chat-message--inverted.chat-message--agent .chat-message__content {
  @apply text-left;
}

.chat-message--system .chat-message__content {
  @apply inline-flex items-center gap-2 bg-blue-100/50 text-blue-800 p-3 rounded-md;
  max-width: 50ch;
}

/* Header styles */
.chat-message__header {
  @apply flex items-center gap-2 mb-1;
}

.chat-message--agent .chat-message__header {
  @apply justify-end;
}

/* Inverted header alignment */
.chat-message--inverted.chat-message--customer .chat-message__header {
  @apply justify-end;
}

.chat-message--inverted.chat-message--agent .chat-message__header {
  @apply justify-start;
}

.chat-message--system .chat-message__header {
  @apply mb-0;
}

.chat-message__sender {
  @apply text-sm font-medium;
}

.chat-message__time {
  @apply text-xs text-muted-foreground;
}

/* Message bubble */
.chat-message__bubble {
  @apply p-3 rounded-lg inline-block text-left;
}

.chat-message--customer .chat-message__bubble {
  @apply bg-muted;
}

.chat-message--agent .chat-message__bubble {
  @apply bg-primary text-primary-foreground;
}

/* Inverted bubble colors */
.chat-message--inverted.chat-message--customer .chat-message__bubble {
  @apply bg-primary text-primary-foreground;
}

.chat-message--inverted.chat-message--agent .chat-message__bubble {
  @apply bg-muted text-foreground;
}

.chat-message__bubble--needs-approval {
  @apply bg-orange-50 border border-orange-200 !important;
  color: initial !important;
}

.chat-message--system .chat-message__bubble {
  @apply p-0 bg-transparent inline;
}

/* Message text */
.chat-message__text {
  @apply text-sm;
}

.chat-message--system .chat-message__text {
  @apply text-xs text-muted-foreground inline;
}

/* Markdown content styles */
.chat-message__text :deep(ol) {
  @apply list-decimal pl-8 my-2;
}

.chat-message__text :deep(ul) {
  @apply list-disc pl-8 my-2;
}

.chat-message__text :deep(ol ol),
.chat-message__text :deep(ol ul),
.chat-message__text :deep(ul ol),
.chat-message__text :deep(ul ul) {
  @apply my-1 pl-4;
}

.chat-message__text :deep(li) {
  @apply my-1;
}

.chat-message__text :deep(p) {
  @apply my-2;
}

.chat-message__text :deep(p:first-child) {
  @apply mt-0;
}

.chat-message__text :deep(p:last-child) {
  @apply mb-0;
}

/* Attachments */
.chat-message__attachments {
  @apply mt-2 flex flex-col gap-1;
}

.chat-message__attachment {
  @apply flex items-center gap-2 text-xs text-muted-foreground;
}

.chat-message__attachment-icon {
  @apply w-3 h-3;
}

/* Action buttons */
.chat-message__actions {
  @apply mt-3 flex gap-2;
}

/* Metadata */
.chat-message__metadata {
  @apply mt-2 pt-2 border-t border-primary-foreground/20;
}

.chat-message__tool {
  @apply flex items-center gap-2 text-xs opacity-80;
}

.chat-message__tool-icon {
  @apply w-3 h-3;
}

.chat-message__confidence {
  @apply text-xs opacity-80 mt-1;
}

/* Playbook badge container */
.chat-message__playbook-badge {
  @apply inline-flex items-center gap-1;
}
</style>
