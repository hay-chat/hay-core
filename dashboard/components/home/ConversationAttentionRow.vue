<template>
  <li class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
    <button
      type="button"
      class="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :aria-label="`${displayName}: ${$t('home.row.open')}`"
      @click="emit('open', conversation.id)"
    >
      <span
        class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background-tertiary"
      >
        <component :is="getChannelIcon(conversation.channel)" class="h-5 w-5 text-neutral-600" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline gap-2">
          <span class="truncate font-medium text-foreground">{{ displayName }}</span>
          <span class="shrink-0 text-xs text-neutral-muted">
            {{ getChannelLabel(conversation.channel) }}
          </span>
        </span>
        <span class="mt-0.5 line-clamp-2 block text-sm text-neutral-600">
          {{ conversation.summary || $t("home.row.noSummary") }}
        </span>
        <span class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs tabular-nums">
          <span v-if="mode === 'pending'" :class="waitClass" class="font-medium">
            {{ $t("home.row.waitingFor", { time: waitLabel }) }}
          </span>
          <span v-else class="text-neutral-muted">
            {{ $t("home.row.since", { time: waitLabel }) }}
          </span>
          <span v-if="mode === 'team' && conversation.handlerName" class="text-neutral-muted">
            {{ $t("home.row.handledBy", { name: conversation.handlerName }) }}
          </span>
        </span>
      </span>
    </button>

    <Button
      v-if="mode === 'pending'"
      class="min-h-11 w-full shrink-0 sm:min-h-0 sm:w-auto"
      :loading="busy"
      data-testid="home-take-over"
      @click="emit('takeover', conversation.id)"
    >
      <UserCheck class="mr-2 h-4 w-4" />
      {{ $t("home.row.takeOver") }}
    </Button>
    <Button
      v-else
      variant="outline"
      class="min-h-11 w-full shrink-0 sm:min-h-0 sm:w-auto"
      @click="emit('open', conversation.id)"
    >
      {{ $t("home.row.open") }}
      <ChevronRight class="ml-1 h-4 w-4" />
    </Button>
  </li>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { UserCheck, ChevronRight } from "lucide-vue-next";
import { formatWaitTime } from "@/utils/conversation";
import { useNow } from "@/composables/useNow";
// getChannelIcon / getChannelLabel are auto-imported from @/utils/channel.

export interface AttentionConversation {
  id: string;
  title: string | null;
  customerName: string | null;
  channel: string;
  summary: string | null;
  /** When the current wait started (last message, else last status change). */
  waitingSince: string;
  handlerName: string | null;
  assignedUserId: string | null;
}

const props = defineProps<{
  conversation: AttentionConversation;
  mode: "pending" | "mine" | "team";
  busy?: boolean;
}>();

const emit = defineEmits<{ open: [id: string]; takeover: [id: string] }>();

const { t } = useI18n();
const now = useNow();

const displayName = computed(
  () =>
    props.conversation.customerName || props.conversation.title || t("home.row.unknownCustomer"),
);

const waitSeconds = computed(() => {
  const since = new Date(props.conversation.waitingSince).getTime();
  if (Number.isNaN(since)) return 0;
  return Math.max(0, Math.floor((now.value.getTime() - since) / 1000));
});

const waitLabel = computed(() => formatWaitTime(waitSeconds.value));

// Thresholds mirror getWaitTimeClass (utils/conversation.ts) but in minutes:
// a human hand-off waits longer than an AI reply before it feels slow.
const waitClass = computed(() => {
  if (waitSeconds.value >= 10 * 60) return "text-destructive-700";
  if (waitSeconds.value >= 3 * 60) return "text-amber-700";
  return "text-neutral-muted";
});
</script>
