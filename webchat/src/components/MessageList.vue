<template>
  <div
    ref="messageListRef"
    class="hay-thread"
    role="log"
    aria-live="polite"
    @scroll="onScroll"
    @load.capture="onMediaLoad"
  >
    <!-- AI disclosure for a new chat (EU AI Act art. 50); hidden when the org hid the AI label -->
    <p v-if="disclosure" class="hay-thread__disclosure">{{ disclosure }}</p>

    <template v-for="item in items" :key="item.key">
      <div v-if="item.type === 'day'" class="hay-thread__day">{{ dayLabel(item.timestamp) }}</div>

      <!-- A team member joined or left: a centred pill -->
      <div v-else-if="item.type === 'notice'" class="hay-notice">
        <Avatar
          v-if="agentFirstName(item.message) || agentAvatarUrl(item.message)"
          kind="human"
          class="hay-notice__avatar"
          :name="agentFirstName(item.message)"
          :src="agentAvatarUrl(item.message)"
        />
        <span class="hay-notice__text"
          >{{ notice(item.message).before }}<b>{{ notice(item.message).name }}</b
          >{{ notice(item.message).after }}</span
        >
      </div>

      <div
        v-else
        class="hay-group"
        :class="item.author.kind === 'visitor' ? 'hay-group--visitor' : 'hay-group--agent'"
      >
        <Avatar
          v-if="item.author.kind !== 'visitor'"
          :kind="item.author.kind"
          :name="item.author.kind === 'human' ? item.author.name : assistantName"
          :src="item.author.kind === 'human' ? item.author.avatarUrl : assistantAvatarUrl"
          :style="{ marginBottom: lastPartIsBubble(item.messages) ? undefined : '18px' }"
        />
        <div class="hay-group__body">
          <span v-if="item.author.kind !== 'visitor'" class="hay-group__name">{{
            item.author.kind === "human" ? item.author.name : aiName
          }}</span>
          <template v-for="(part, i) in groupParts(item.messages)" :key="part.key">
            <div
              v-if="part.kind === 'text'"
              v-height-animate="animateEntranceIds.has(part.message.id)"
              class="hay-bubble"
              :class="{
                'hay-bubble--follow': i > 0,
                'hay-bubble--rich': part.message.sender === 'agent',
              }"
            >
              <div
                v-if="part.message.sender === 'agent'"
                class="hay-bubble__text"
                v-html="
                  animatingIds.has(part.message.id) && part.single
                    ? getAnimatedHtml(part.text, approvedImages(part.message))
                    : parseMarkdown(part.text, approvedImages(part.message))
                "
              ></div>
              <template v-else>{{ part.text }}</template>
              <span v-if="part.last" class="hay-bubble__time">{{
                formatTime(part.message.timestamp)
              }}</span>
            </div>

            <!-- A markdown image on its own: the image is the bubble -->
            <div
              v-else-if="part.kind === 'image'"
              v-height-animate="animateEntranceIds.has(part.message.id)"
              class="hay-bubble hay-bubble--rich hay-bubble--image"
              v-html="parseMarkdown(part.text, approvedImages(part.message))"
            ></div>

            <!-- Product recommendation cards -->
            <div
              v-else-if="part.kind === 'products'"
              class="hay-bubble hay-bubble--rich hay-bubble--follow"
            >
              <div class="hay-product-recs">
                <a
                  v-for="p in part.products"
                  :key="p.id || p.externalId"
                  :href="safeHttpUrl(p.sourceUrl) ?? '#'"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hay-product-card"
                >
                  <div class="hay-product-card__image">
                    <img v-if="p.imageUrl" :src="p.imageUrl" :alt="p.title" loading="lazy" />
                  </div>
                  <div class="hay-product-card__body">
                    <div class="hay-product-card__title">{{ p.title }}</div>
                    <div v-if="p.topVariant?.price" class="hay-product-card__price">
                      {{ formatPrice(p.topVariant.price, p.topVariant.currency) }}
                    </div>
                    <div v-if="p.available === false" class="hay-product-card__oos">
                      Out of stock
                    </div>
                  </div>
                </a>
              </div>
            </div>

            <!-- FORM messages: the form itself, or the answers once submitted -->
            <FormMessage
              v-else-if="part.kind === 'form'"
              :schema="part.form.schema!"
              :submitted="part.form.status === 'SUBMITTED'"
              :submitted-response="part.form.response"
              @submit="(response) => $emit('submitForm', part.message.id, response)"
            />

            <!-- Files: photos inline, other files as a link (signed, expiring URLs) -->
            <div v-else class="hay-message__attachments">
              <template v-for="attachment in part.message.attachments" :key="attachment.id">
                <a
                  v-if="isImageAttachment(attachment.type) && attachment.url"
                  :href="attachment.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hay-message__attachment-image"
                  :class="{ 'hay-message__attachment--pending': part.message.metadata?.pending }"
                >
                  <img :src="attachment.url" :alt="attachment.name || t('attachment.photo')" />
                </a>
                <component
                  :is="attachment.url ? 'a' : 'span'"
                  v-else
                  :href="attachment.url || undefined"
                  :target="attachment.url ? '_blank' : undefined"
                  :rel="attachment.url ? 'noopener noreferrer' : undefined"
                  class="hay-message__attachment-file"
                >
                  <span class="hay-message__attachment-name">{{
                    attachment.name || t("attachment.file")
                  }}</span>
                  <span class="hay-message__attachment-size">{{
                    part.message.metadata?.pending && !attachment.url
                      ? t("attachment.sending")
                      : formatFileSize(attachment.size)
                  }}</span>
                </component>
              </template>
            </div>
          </template>
          <!-- The group ends in something other than a text bubble: its time goes below -->
          <span v-if="!lastPartIsBubble(item.messages)" class="hay-group__time">{{
            formatTime(item.messages[item.messages.length - 1].timestamp)
          }}</span>
        </div>
      </div>
    </template>

    <div v-if="isTyping" class="hay-group hay-group--agent">
      <Avatar
        :kind="typingHuman ? 'human' : 'ai'"
        :name="typingHuman?.name ?? assistantName"
        :src="typingHuman ? typingHuman.avatarUrl : assistantAvatarUrl"
      />
      <div class="hay-bubble hay-typing">
        <span class="hay-typing__dot" aria-hidden="true"></span>
        <span class="hay-typing__dot" aria-hidden="true"></span>
        <span class="hay-typing__dot" aria-hidden="true"></span>
        <span class="hay-sr-only">{{
          t("chat.typing").replace("{name}", typingHuman?.name ?? assistantName)
        }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch, nextTick, type Directive } from "vue";
import type { Message } from "@/types";
import {
  parseMarkdown,
  safeHttpUrl,
  wrapWordsForAnimation,
  splitMarkdownImages,
} from "@/utils/markdown";
import { useI18n } from "@/i18n";
import { agentAvatarUrl, agentFirstName, agentNotice, type AgentNotice } from "@/utils/agentNotice";
import { formatFileSize, isImageAttachment } from "@/utils/attachments";
import { buildThread } from "@/utils/thread";
import Avatar from "./Avatar.vue";
import type { FormResponse, FormSchema } from "@hay/form-schema";

// Forms are rare on a first open, so their code loads only when one shows.
const FormMessage = defineAsyncComponent(() => import("./FormMessage.vue"));

const t = useI18n();

const props = defineProps<{
  messages: Message[];
  isTyping: boolean;
  greetingMessage?: string;
  /** The AI's name on its message groups, e.g. "Acme assistant". */
  assistantName: string;
  assistantAvatarUrl?: string | null;
  /** Label after the AI's name ("· AI"); null or empty hides it. */
  aiLabel?: string | null;
  /** Line above a new chat saying the AI answers; null hides it. */
  disclosure?: string | null;
  /** The person who has taken over, for the typing bubble; null while the AI answers. */
  typingHuman?: { name: string; avatarUrl: string | null } | null;
  /** BCP 47 locale for the day dividers. */
  locale?: string;
}>();

defineEmits<{
  submitForm: [messageId: string, response: FormResponse];
}>();

interface FormUi {
  kind?: string;
  schema?: FormSchema;
  status?: string;
  response?: FormResponse;
}

interface ProductCard {
  id?: string;
  externalId?: string;
  title?: string;
  imageUrl?: string;
  sourceUrl?: string;
  available?: boolean;
  topVariant?: { price?: string | number; currency?: string };
}

type Part =
  | {
      kind: "text" | "image";
      key: string;
      message: Message;
      text: string;
      /** The message is this one segment (the word reveal runs only then). */
      single: boolean;
      /** The group's last bubble: it carries the time. */
      last?: boolean;
    }
  | { kind: "products"; key: string; message: Message; products: ProductCard[] }
  | { kind: "form"; key: string; message: Message; form: FormUi }
  | { kind: "files"; key: string; message: Message };

/** The form carried by a FORM message (server `metadata.ui`), or null. */
function formUi(message: Message): FormUi | null {
  const ui = message.metadata?.ui as FormUi | undefined;
  return ui?.kind === "form" && ui.schema ? ui : null;
}

function productsOf(message: Message): ProductCard[] | null {
  if (message.agentType !== "ProductRecommendation") return null;
  const recommendation = message.metadata?.productRecommendation as
    { products?: unknown } | undefined;
  return Array.isArray(recommendation?.products)
    ? (recommendation.products as ProductCard[])
    : null;
}

// A "[Customer sent a photo]" line is for the AI; the shopper sees the photo.
const showsText = (message: Message): boolean => {
  if (!message.content) return false;
  return !(message.metadata?.mediaPlaceholder === true && message.attachments?.length);
};

const isImageSegment = (segment: string): boolean =>
  /^!\[[^\]]*\]\([^)]*\)\s*$/.test(segment.trim());

/** What one message shows, in order: its bubbles, products, form and files. */
function partsOf(message: Message): Part[] {
  const parts: Part[] = [];
  const form = formUi(message);
  const products = productsOf(message);
  if (form) {
    parts.push({ kind: "form", key: `${message.id}-form`, message, form });
  } else if (products) {
    parts.push({ kind: "products", key: `${message.id}-products`, message, products });
  } else if (showsText(message)) {
    // Agent replies: one bubble per image segment (word reveal only for a
    // single, image-free segment). The shopper's own text is never markdown.
    const segments =
      message.sender === "agent" ? splitMarkdownImages(message.content) : [message.content];
    segments.forEach((text, i) =>
      parts.push({
        kind: message.sender === "agent" && isImageSegment(text) ? "image" : "text",
        key: `${message.id}-${i}`,
        message,
        text,
        single: segments.length === 1,
      }),
    );
  }
  if (message.attachments?.length) {
    parts.push({ kind: "files", key: `${message.id}-files`, message });
  }
  return parts;
}

/** A group's parts; the time sits inside its last bubble when that is text. */
function groupParts(messages: Message[]): Part[] {
  const parts = messages.flatMap(partsOf);
  const last = parts[parts.length - 1];
  if (last?.kind === "text") parts[parts.length - 1] = { ...last, last: true };
  return parts;
}

const lastPartIsBubble = (messages: Message[]) => {
  const parts = partsOf(messages[messages.length - 1]);
  return parts[parts.length - 1]?.kind === "text";
};

// With nothing sent yet, the greeting stands in as the first AI message.
const displayMessages = computed<Message[]>(() =>
  props.messages.length === 0 && props.greetingMessage
    ? [
        {
          id: "greeting",
          sender: "agent",
          content: props.greetingMessage,
          timestamp: Date.now(),
          isGreeting: true,
        },
      ]
    : props.messages,
);

const items = computed(() => buildThread(displayMessages.value));

const aiName = computed(() =>
  props.aiLabel ? `${props.assistantName} · ${props.aiLabel}` : props.assistantName,
);

const notice = (message: Message): AgentNotice =>
  agentNotice(message, t) ?? { before: "", name: "", after: "" };

const dayLabel = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return t("chat.today");
  return new Intl.DateTimeFormat(props.locale, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
};

const messageListRef = ref<HTMLElement | null>(null);
const seenIds = new Set<string>(props.messages.map((m) => m.id));
const animatingIds = ref(new Set<string>());
// Track which messages should get entrance animations (only single-message arrivals, not bulk loads)
const animateEntranceIds = new Set<string>();

// Animate element height from 0 to natural height using Web Animations API
const animateHeight = (el: HTMLElement, duration = 500) => {
  const height = el.scrollHeight;

  return el.animate(
    [
      { height: "0px", opacity: 0 },
      { height: `${height}px`, opacity: 1 },
    ],
    { duration, easing: "ease-in-out" },
  );
};

// Keep scroll pinned to bottom while an animation is running
const scrollDuringAnimation = (animation: Animation) => {
  if (!messageListRef.value) return;
  const container = messageListRef.value;
  const tick = () => {
    container.scrollTop = container.scrollHeight;
    if (animation.playState === "running") {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
};

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Height animation directive for new messages on mount
const vHeightAnimate: Directive<HTMLElement, boolean> = {
  mounted(el, binding) {
    if (!binding.value || reducedMotion() || typeof el.animate !== "function") return;
    const animation = animateHeight(el);
    scrollDuringAnimation(animation);
  },
};

// The images the server cleared for this reply; anything else is shown as a link.
const approvedImages = (message: Message): string[] => {
  const approved = message.metadata?.approvedImages;
  return Array.isArray(approved) ? approved.filter((url) => typeof url === "string") : [];
};

const getAnimatedHtml = (content: string, approved: readonly string[]): string => {
  const parsed = parseMarkdown(content, approved);
  return wrapWordsForAnimation(parsed).html;
};

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
};

const formatPrice = (amount?: string | number, currency?: string): string => {
  if (amount === undefined || amount === null || amount === "") return "";
  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(value)) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ""}`.trim();
  }
};

// Images load after the list first scrolls, which would push the newest message out of view.
// Stay pinned to the bottom while they load, unless the shopper has scrolled up to read.
const pinnedToBottom = ref(true);
const onScroll = () => {
  const el = messageListRef.value;
  if (!el) return;
  pinnedToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
};
const onMediaLoad = () => {
  if (pinnedToBottom.value) scrollToBottom();
};

const scrollToBottom = () => {
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
    }
  });
};

// Detect new messages and trigger animations only for single-message arrivals
// Bulk loads (history, refresh) skip all animations
watch(
  () => props.messages.length,
  () => {
    const newMessages = props.messages.filter((msg) => !seenIds.has(msg.id));

    for (const msg of newMessages) {
      seenIds.add(msg.id);
    }

    // Only animate when a single message arrives (not bulk loads like history)
    if (newMessages.length === 1 && !reducedMotion()) {
      const msg = newMessages[0];
      animateEntranceIds.add(msg.id);

      if (msg.sender === "agent" && msg.content) {
        animatingIds.value.add(msg.id);
        const parsed = parseMarkdown(msg.content);
        const { wordCount } = wrapWordsForAnimation(parsed);
        const duration = wordCount * 20 + 1000;
        setTimeout(() => {
          animatingIds.value.delete(msg.id);
        }, duration);
      }
    }

    scrollToBottom();
  },
  { immediate: true },
);

// Also scroll when typing indicator changes
watch(
  () => props.isTyping,
  () => {
    scrollToBottom();
  },
);
</script>

<style>
.hay-thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Push a short conversation to the bottom, next to the composer. */
.hay-thread > :first-child {
  margin-top: auto;
}

.hay-thread__disclosure {
  align-self: center;
  max-width: 290px;
  margin: 0;
  font-size: 12px;
  color: var(--hay-meta);
  text-align: center;
}

.hay-thread__day {
  align-self: center;
  font-size: 12px;
  color: var(--hay-meta);
}

/* Join / leave notices */
.hay-notice {
  align-self: center;
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 92%;
  padding: 4px 12px 4px 4px;
  border-radius: 999px;
  background: var(--hay-bubble);
  font-size: 12.5px;
  color: var(--hay-meta);
}

.hay-notice__avatar {
  width: 22px;
  height: 22px;
  font-size: 10.5px;
}

.hay-notice b {
  font-weight: 600;
  color: var(--hay-text);
}

/* Message groups: one avatar (beside the last bubble) and one name line */
.hay-group {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  max-width: 100%;
}

.hay-group--visitor {
  align-self: flex-end;
  max-width: 78%;
}

.hay-group__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  max-width: 82%;
}

.hay-group--visitor .hay-group__body {
  max-width: 100%;
  align-items: flex-end;
}

.hay-group--agent .hay-group__body {
  align-items: flex-start;
}

.hay-group__name {
  padding-left: 4px;
  font-size: 12px;
  color: var(--hay-meta);
}

.hay-group__time {
  padding: 0 4px;
  font-size: 11px;
  color: var(--hay-meta);
}

/* Bubbles */
.hay-bubble {
  max-width: 100%;
  padding: 9px 12px;
  border-radius: 16px 16px 16px 6px;
  background: var(--hay-bubble);
  color: var(--hay-text);
  overflow-wrap: anywhere;
}

.hay-bubble--follow {
  border-top-left-radius: 6px;
}

.hay-group--visitor .hay-bubble {
  border-radius: 16px 16px 6px 16px;
  background: var(--hay-brand);
  color: var(--hay-on-brand);
  white-space: pre-wrap;
}

.hay-group--visitor .hay-bubble--follow {
  border-top-right-radius: 6px;
}

/* The time sits at the end of the last line, inside the bubble. */
.hay-bubble__time {
  float: right;
  margin: 6px 0 0 10px;
  font-size: 11px;
  line-height: 1.2;
  color: var(--hay-meta);
  white-space: nowrap;
}

.hay-group--visitor .hay-bubble__time {
  color: inherit;
  opacity: 0.85;
}

.hay-bubble__text,
.hay-bubble__text > p:last-child {
  display: inline;
}

.hay-bubble--image {
  padding: 0;
  overflow: hidden;
  background: transparent;
}

/* Markdown inside bubbles */
.hay-bubble--rich img {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 12px;
}

.hay-bubble--rich a {
  color: var(--hay-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.hay-bubble--rich strong {
  font-weight: 600;
}

.hay-bubble--rich code {
  background: var(--hay-surface);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}

.hay-bubble--rich ul,
.hay-bubble--rich ol {
  margin: 4px 0;
  padding-left: 20px;
}

.hay-bubble--rich li {
  margin: 2px 0;
}

.hay-bubble--rich p {
  margin: 0 0 8px;
}

/* Files */
.hay-message__attachments {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: inherit;
}

.hay-message__attachment-image img {
  display: block;
  max-width: 220px;
  max-height: 260px;
  border-radius: 14px;
  object-fit: cover;
}

.hay-message__attachment--pending {
  opacity: 0.6;
}

.hay-message__attachment-file {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 240px;
  padding: 8px 12px;
  border-radius: 14px;
  border: 1px solid var(--hay-line);
  background: var(--hay-raised);
  color: var(--hay-text);
  font-size: 13px;
  text-decoration: none;
}

a.hay-message__attachment-file:hover {
  border-color: var(--hay-accent);
}

.hay-message__attachment-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hay-message__attachment-size {
  font-size: 11px;
  color: var(--hay-meta);
}

/* Word-by-word reveal animation */
.hay-word {
  opacity: 0;
  animation: wordReveal 1s ease forwards;
}

@keyframes wordReveal {
  from {
    opacity: 0;
    filter: blur(0.1em);
  }
  to {
    opacity: 1;
    filter: blur(0);
  }
}

/* Typing: dots inside a bubble */
.hay-typing {
  display: flex;
  gap: 5px;
  padding: 12px 14px;
}

.hay-typing__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--hay-meta);
  animation: hay-typing 1.4s infinite;
}

.hay-typing__dot:nth-child(2) {
  animation-delay: 0.2s;
}

.hay-typing__dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes hay-typing {
  0%,
  60%,
  100% {
    opacity: 0.45;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

/* Product recommendation cards */
.hay-product-recs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
  min-width: 248px;
}

.hay-product-card {
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  border: 1px solid var(--hay-line);
  background: var(--hay-surface);
  text-decoration: none;
  color: inherit;
  overflow: hidden;
}

.hay-product-card:hover {
  border-color: var(--hay-accent);
}

.hay-product-card__image {
  aspect-ratio: 1 / 1;
  background: var(--hay-raised);
}

.hay-product-card__image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 0;
}

.hay-product-card__body {
  padding: 6px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hay-product-card__title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hay-product-card__price {
  font-size: 12px;
  font-weight: 600;
  color: var(--hay-accent);
}

.hay-product-card__oos {
  font-size: 10px;
  color: var(--hay-meta);
}
</style>
