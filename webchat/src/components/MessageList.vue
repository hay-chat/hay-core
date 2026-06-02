<template>
  <div class="hay-message-list" ref="messageListRef">
    <!-- Greeting Message -->
    <div v-if="greetingMessage && messages.length === 0" class="hay-message hay-message--agent">
      <div class="hay-message__content hay-message__content--rich">{{ greetingMessage }}</div>
    </div>

    <div
      v-for="message in messages"
      :key="message.id"
      v-height-animate="animateEntranceIds.has(message.id)"
      class="hay-message"
      :class="{
        'hay-message--user': message.sender === 'user',
        'hay-message--agent': message.sender === 'agent',
        'hay-message--closure': message.metadata?.isClosureMessage,
      }"
    >
      <div v-if="message.metadata?.isClosureMessage" class="hay-message__closure-badge">
        {{ t("chat.conversationClosed") }}
      </div>
      <div
        class="hay-message__content"
        :class="{ 'hay-message__content--rich': message.sender === 'agent' }"
      >
        <!-- Product recommendation cards -->
        <template
          v-if="
            message.agentType === 'ProductRecommendation' &&
            message.metadata &&
            Array.isArray((message.metadata as any).productRecommendation?.products)
          "
        >
          <div class="hay-product-recs">
            <a
              v-for="p in (message.metadata as any).productRecommendation.products as any[]"
              :key="p.id || p.externalId"
              :href="p.sourceUrl || '#'"
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
                <div v-if="p.available === false" class="hay-product-card__oos">Out of stock</div>
              </div>
            </a>
          </div>
        </template>
        <!-- Agent messages: animated word reveal or static markdown -->
        <template v-else-if="message.sender === 'agent'">
          <div v-if="animatingIds.has(message.id)" v-html="getAnimatedHtml(message.content)"></div>
          <div v-else v-html="renderMarkdown(message.content)"></div>
        </template>
        <!-- User messages: plain text -->
        <template v-else>{{ message.content }}</template>
      </div>
      <div class="hay-message__time">
        {{ formatTime(message.timestamp) }}
      </div>
    </div>

    <div v-if="isTyping" class="hay-message hay-message--agent">
      <div class="hay-message__content hay-message__typing">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, type Directive } from "vue";
import type { Message } from "@/types";
import { parseMarkdown, wrapWordsForAnimation } from "@/utils/markdown";
import { useI18n } from "@/i18n";

const t = useI18n();

const props = defineProps<{
  messages: Message[];
  isTyping: boolean;
  greetingMessage?: string;
}>();

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

// Height animation directive for new messages on mount
const vHeightAnimate: Directive<HTMLElement, boolean> = {
  mounted(el, binding) {
    if (!binding.value) return;
    const animation = animateHeight(el);
    scrollDuringAnimation(animation);
  },
};

const renderMarkdown = (content: string): string => {
  return parseMarkdown(content);
};

const getAnimatedHtml = (content: string): string => {
  const parsed = parseMarkdown(content);
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
    if (newMessages.length === 1) {
      const msg = newMessages[0];
      animateEntranceIds.add(msg.id);

      if (msg.sender === "agent") {
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
.hay-message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hay-message-list__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-neutral-400);
  gap: 12px;
}

.hay-message-list__empty p {
  margin: 0;
  font-size: 14px;
}

.hay-message {
  max-width: 80%;
  display: flex;
  flex-direction: column;
}

.hay-message--user {
  align-self: flex-end;
}

.hay-message--agent {
  align-self: flex-start;
}

.hay-message__content {
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
  word-wrap: break-word;
}

.hay-message--user .hay-message__content {
  background: var(--hay-primary);
  color: white;
  border-bottom-right-radius: 4px;
  white-space: pre-wrap;
  padding: 10px 14px;
}

.hay-message--agent .hay-message__content {
  color: var(--color-neutral-800);
  border-bottom-left-radius: 4px;
}

/* Markdown content styles (using since v-html bypasses scoped styles) */
.hay-message__content--rich a {
  color: var(--hay-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.hay-message__content--rich a:hover {
  opacity: 0.8;
}

.hay-message__content--rich strong {
  font-weight: 600;
}

.hay-message__content--rich code {
  background: var(--color-neutral-100);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}

.hay-message__content--rich ul,
.hay-message__content--rich ol {
  margin: 4px 0;
  padding-left: 20px;
}

.hay-message__content--rich li {
  margin: 2px 0;
}

.hay-message__content--rich p {
  margin: 0;
}

.hay-message__content--rich p:not(:last-child):not(:only-child) {
  margin-bottom: 12px;
}

.hay-message__time {
  font-size: 11px;
  color: var(--color-neutral-400);
  margin-top: 4px;
}

.hay-message--user .hay-message__time {
  text-align: right;
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

/* Typing indicator */
.hay-message__typing {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 12px 0 24px;
}

.hay-message__typing span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-neutral-400);
  animation: typing 1.4s infinite;
}

.hay-message__typing span:nth-child(2) {
  animation-delay: 0.2s;
}

.hay-message__typing span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.7;
  }
  30% {
    transform: translateY(-10px);
    opacity: 1;
  }
}

/* Closure message styling */
.hay-message__closure-badge {
  font-size: 11px;
  color: var(--color-neutral-500);
  font-weight: 600;
  margin-bottom: 4px;
  padding: 4px 8px;
  background: var(--color-neutral-200);
  border-radius: 8px;
  display: inline-block;
  align-self: flex-start;
}

/* Product recommendation cards */
.hay-product-recs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
  margin: 4px 0;
}

.hay-product-card {
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  border: 1px solid var(--color-neutral-200, #e5e7eb);
  background: white;
  text-decoration: none;
  color: inherit;
  overflow: hidden;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.hay-product-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.hay-product-card__image {
  aspect-ratio: 1 / 1;
  background: var(--color-neutral-100, #f3f4f6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.hay-product-card__image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
  color: var(--hay-primary);
}

.hay-product-card__oos {
  font-size: 10px;
  color: var(--color-neutral-500);
}
</style>
