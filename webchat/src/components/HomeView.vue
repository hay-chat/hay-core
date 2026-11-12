<template>
  <div class="hay-home">
    <div class="hay-home__top">
      <button
        type="button"
        class="hay-home__close"
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
    </div>

    <div class="hay-home__main">
      <span class="hay-home__logo" aria-hidden="true">
        <img v-if="logoUrl && !logoFailed" :src="logoUrl" alt="" @error="logoFailed = true" />
        <template v-else>{{ title.trim().charAt(0).toUpperCase() }}</template>
      </span>
      <h2 class="hay-home__heading">{{ heading }}</h2>
      <span v-if="statusLine" class="hay-home__status">
        <span
          class="hay-home__dot"
          :class="{ 'hay-home__dot--away': status && !status.online }"
          aria-hidden="true"
        ></span>
        {{ statusLine }}
      </span>
      <div class="hay-home__ask">
        <MessageInput
          ref="inputRef"
          home
          :is-ready="true"
          :placeholder="t('home.placeholder')"
          @send="$emit('send', $event)"
          @attach="(file, caption) => $emit('attach', file, caption)"
        />
      </div>
      <p v-if="disclosure" class="hay-home__helper">{{ disclosure }}</p>
    </div>

    <section v-if="rows.length" class="hay-home__list" :aria-labelledby="listId">
      <h3 :id="listId" class="hay-home__list-title">{{ t("home.yourConversations") }}</h3>
      <button
        v-for="row in rows"
        :key="row.id"
        type="button"
        class="hay-home__row"
        :class="{ 'hay-home__row--open': row.status === 'open' }"
        :aria-disabled="!row.resumable || undefined"
        :aria-describedby="unavailableId === row.id ? noteId : undefined"
        @click="pick(row)"
      >
        <Avatar
          :kind="isHuman(row) ? 'human' : 'ai'"
          :name="row.lastSenderName ?? undefined"
          :src="isHuman(row) ? teamAvatar(row.lastSenderName) : assistantAvatarUrl"
        />
        <span class="hay-home__row-text">
          <b v-if="row.status === 'open'">{{ senderLabel(row) }}:</b>
          {{ row.lastMessagePreview || t("attachment.file") }}
        </span>
        <span v-if="row.status === 'open'" class="hay-home__pill">{{ t("home.open") }}</span>
        <span v-else class="hay-home__date">
          <span class="hay-sr-only">{{ t("chat.conversationEnded") }}, </span>
          {{ dateLabel(row.lastMessageAt) }}
        </span>
      </button>
      <p :id="noteId" class="hay-home__note" role="status">
        <template v-if="unavailableId">{{ t("home.otherDevice") }}</template>
      </p>
    </section>

    <PoweredBy />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import css from "./HomeView.css?inline";
import Avatar from "./Avatar.vue";
import MessageInput from "./MessageInput.vue";
import PoweredBy from "./PoweredBy.vue";
import { useI18n } from "@/i18n";
import {
  homeConversations,
  listMyConversations,
  summarizeThread,
} from "@/utils/visitorConversations";
import type { HeaderStatus } from "@/utils/availability";
import type { HayChatConfig, Message, TeamMember, VisitorConversation } from "@/types";

// Vite puts every <style> block into the one stylesheet inlined in the chat
// chunk (vite.config.ts); this component loads on demand, so it brings its own.
if (!document.getElementById("hay-home-css")) {
  const style = document.createElement("style");
  style.id = "hay-home-css";
  style.textContent = css;
  document.head.appendChild(style);
}

const t = useI18n();

const props = defineProps<{
  /** The shop's name for the chat; its initial stands in for a missing logo. */
  title: string;
  logoUrl?: string;
  heading: string;
  /** The organization's name, before the status ("Acme · Typically replies in 2 min"). */
  organizationName?: string | null;
  status?: HeaderStatus | null;
  /** The AI disclosure line under the message box; null hides it. */
  disclosure?: string | null;
  /** For `listMine` ("Your conversations", only after consent). */
  config: HayChatConfig;
  /** The preview's sample list, used instead of asking the server. */
  sampleConversations?: VisitorConversation[];
  /** The conversation open in this tab, which shows even before consent. */
  currentThread?: { id: string; messages: Message[]; closed: boolean } | null;
  assistantName: string;
  assistantAvatarUrl?: string;
  team: TeamMember[];
  locale?: string;
  /** Move focus to the message box (desktop; never in the preview). */
  autofocus?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  send: [message: string];
  attach: [file: File, caption: string];
  open: [conversationId: string];
}>();

const uid = Math.random().toString(36).slice(2, 8);
const listId = `hay-home-list-${uid}`;
const noteId = `hay-home-note-${uid}`;
const logoFailed = ref(false);
const unavailableId = ref<string | null>(null);
const inputRef = ref<InstanceType<typeof MessageInput> | null>(null);
const conversations = ref<VisitorConversation[]>(props.sampleConversations ?? []);

const statusLine = computed(() =>
  [props.organizationName, props.status?.text].filter(Boolean).join(" · "),
);

const rows = computed(() => {
  const current = props.currentThread
    ? summarizeThread(props.currentThread, props.assistantName)
    : null;
  const others = conversations.value.filter((c) => c.id !== current?.id);
  return homeConversations(current ? [current, ...others] : others);
});

const isHuman = (row: VisitorConversation) =>
  row.lastSenderName !== null && row.lastSenderName !== props.assistantName;

const senderLabel = (row: VisitorConversation) => row.lastSenderName ?? t("home.you");

const teamAvatar = (name: string | null) =>
  props.team.find((member) => member.firstName === name)?.avatarUrl ?? null;

function dateLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(props.locale, { hour: "2-digit", minute: "2-digit" }).format(
      date,
    );
  }
  return new Intl.DateTimeFormat(props.locale, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
}

function pick(row: VisitorConversation) {
  if (!row.resumable) {
    unavailableId.value = row.id;
    return;
  }
  unavailableId.value = null;
  emit("open", row.id);
}

onMounted(async () => {
  if (props.autofocus) void nextTick(() => inputRef.value?.focus());
  // Asked each time home shows, so the list is fresh after a conversation.
  if (!props.sampleConversations) conversations.value = await listMyConversations(props.config);
});
</script>
