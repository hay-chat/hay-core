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
      v-if="showHeader !== false && variant !== 'System'"
      class="chat-message__avatar"
    >
      <component :is="avatarIcon" class="chat-message__avatar-icon" />
    </div>
    <div class="chat-message__content">
      <div v-if="showHeader !== false" class="chat-message__header">
        <span
          v-if="senderName && variant !== 'System'"
          class="chat-message__sender"
          >{{ senderName }}</span
        >
        <span v-if="variant !== 'System'" class="chat-message__time">{{
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
            'chat-message__bubble--collapsed':
              isCollapsibleVariant && isSystemCollapsed,
            'chat-message__bubble--expanded':
              isCollapsibleVariant && !isSystemCollapsed && isSystemExpandable,
          },
        ]"
      >
        <div
          class="chat-message__text"
          ref="systemMessageRef"
          v-html="markdownToHtml(content)"
        ></div>
      </div>
      <div
        v-if="isCollapsibleVariant && isSystemExpandable"
        @click="toggleSystemExpanded"
        class="chat-message__expand-button"
      >
        <ChevronDown v-if="isSystemCollapsed" class="h-3 w-3" />
        <ChevronUp v-else class="h-3 w-3" />
        {{ isSystemCollapsed ? "Expand" : "Collapse" }}
      </div>
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
        v-else-if="metadata && variant === 'BotAgent'"
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
</template>

<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch } from "vue";
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
  ChevronDown,
  ChevronUp,
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
  variant:
    | "Customer"
    | "BotAgent"
    | "System"
    | "HumanAgent"
    | "ToolCall"
    | "ToolResponse";
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

// System message collapse/expand logic
const systemMessageRef = ref<HTMLElement | null>(null);
const isSystemExpandable = ref(false);
const isSystemCollapsed = ref(false);
const isCollapsibleVariant = computed(() =>
  ["System", "ToolCall", "ToolResponse"].includes(props.variant)
);

const checkSystemMessageHeight = async () => {
  if (isCollapsibleVariant && systemMessageRef.value) {
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
  () => props.content,
  () => {
    if (isCollapsibleVariant) {
      nextTick(() => checkSystemMessageHeight());
    }
  }
);

const formattedTime = computed(() => {
  const date = new Date(props.timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
});

const avatarIcon = computed(() => {
  if (props.variant === "Customer") return User;
  if (props.variant === "BotAgent" || props.variant === "HumanAgent")
    return Bot;

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

<style lang="scss">
/* Base message container */
.chat-message {
  display: flex;
  font-size: 0.875rem;
  justify-content: flex-start;
  flex-direction: row-reverse;
  gap: 0.5rem;
}

.chat-message--Customer {
  flex-direction: row;
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
  border-radius: var(--radius);
  overflow: hidden;
  background-color: hsl(var(--primary));
  color: white;
  padding: 1rem;
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
    background: linear-gradient(to bottom, transparent, #ecf3fe 90%);
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
.chat-message--System,
.chat-message--ToolCall,
.chat-message--ToolResponse {
  .chat-message__bubble {
    background-color: #ecf3fe;
    color: hsl(var(--foreground));
  }
}

.chat-message--ToolCall,
.chat-message--ToolResponse {
  .chat-message__bubble {
    font-family: monospace;
    font-size: 0.75rem;
    white-space: pre-wrap;
  }
}

.chat-message--Customer .chat-message__bubble {
  background-color: hsl(var(--secondary));
  color: hsl(var(--foreground));
}

.chat-message__avatar {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background-color: hsl(var(--secondary));
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground));
  font-size: 1rem;

  svg {
    height: 1em;
    width: 1em;
  }
}

.chat-message__sender {
  font-weight: bold;
  margin-right: 0.5rem;
}

.chat-message__time {
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}
</style>
