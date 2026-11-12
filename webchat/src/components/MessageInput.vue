<template>
  <div class="hay-composer">
    <p v-if="failure" class="hay-composer__error" role="alert">
      {{ t(FAILURE_KEYS[failure.reason]) }}
    </p>
    <Transition name="hay-counter">
      <span
        v-if="messageText.length > 750"
        class="hay-composer__counter"
        :class="{
          'hay-composer__counter--danger': messageText.length > 900,
          'hay-composer__counter--shake': isShaking,
        }"
      >
        {{ messageText.length }}/{{ MAX_LENGTH }}
      </span>
    </Transition>
    <div class="hay-composer__field">
      <!-- The picked file waits here and goes with the next send, the text as its caption -->
      <div v-if="pendingFile" class="hay-composer__chip">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        <span class="hay-composer__chip-name">{{ pendingFile.name }}</span>
        <span class="hay-composer__chip-size">{{ formatFileSize(pendingFile.size) }}</span>
        <button
          type="button"
          class="hay-composer__chip-remove"
          :aria-label="`${t('input.removeFile')}: ${pendingFile.name}`"
          @click="removeFile"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="hay-composer__row">
        <button
          type="button"
          @click="fileInputRef?.click()"
          :disabled="!isReady"
          class="hay-composer__attach"
          :aria-label="t('input.attach')"
          :title="t('input.attach')"
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
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <input
          ref="fileInputRef"
          type="file"
          :accept="WIDGET_ATTACHMENT_ACCEPT"
          class="hay-composer__file"
          tabindex="-1"
          aria-hidden="true"
          @change="handleFile"
        />
        <textarea
          v-model="messageText"
          @keydown="handleKeydown"
          @input="handleInput"
          :placeholder="t('input.placeholder')"
          :aria-label="t('input.placeholder')"
          rows="1"
          ref="textareaRef"
          :disabled="!isReady"
          :maxlength="MAX_LENGTH"
          class="hay-composer__textarea"
        ></textarea>
        <button
          type="button"
          @click="handleSend"
          :disabled="!canSend"
          class="hay-composer__send"
          :aria-label="t('input.send')"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch } from "vue";
import { useI18n } from "@/i18n";
import type { SendFailure } from "@/types";
import type { TranslationKey } from "@/i18n";
import { WIDGET_ATTACHMENT_ACCEPT, formatFileSize } from "@/utils/attachments";

const t = useI18n();

const props = defineProps<{
  isReady: boolean;
  failure?: SendFailure | null;
}>();

const emit = defineEmits<{
  send: [message: string];
  /** A photo or PDF, with what was typed as its caption. */
  attach: [file: File, caption: string];
  startTyping: [];
  stopTyping: [];
}>();

const MAX_LENGTH = 1000;
const messageText = ref("");
const pendingFile = ref<File | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

const canSend = computed(
  () => props.isReady && (pendingFile.value !== null || messageText.value.trim() !== ""),
);

const FAILURE_KEYS: Record<SendFailure["reason"], TranslationKey> = {
  sendFailed: "error.sendFailed",
  messageTooLong: "error.messageTooLong",
  fileTooLarge: "error.fileTooLarge",
  fileType: "error.fileType",
  fileFailed: "error.fileFailed",
  verificationFailed: "error.verificationFailed",
};
const isShaking = ref(false);
let shakeTimeout: ReturnType<typeof setTimeout> | null = null;

// Grows with the text up to four lines (max-height in CSS), then scrolls.
const resizeTextarea = () => {
  if (textareaRef.value) {
    textareaRef.value.style.height = "auto";
    textareaRef.value.style.height = textareaRef.value.scrollHeight + "px";
  }
};

// A refused message comes back so the shopper can retry without retyping.
// Don't overwrite anything they have started typing since.
watch(
  () => props.failure,
  (failure) => {
    if (!failure || messageText.value) return;
    messageText.value = failure.text;
    nextTick(resizeTextarea);
  },
);

const handleInput = () => {
  resizeTextarea();

  // Emit typing indicator
  if (messageText.value.trim()) {
    emit("startTyping");
  } else {
    emit("stopTyping");
  }
};

const triggerShake = () => {
  if (shakeTimeout) clearTimeout(shakeTimeout);
  isShaking.value = true;
  shakeTimeout = setTimeout(() => {
    isShaking.value = false;
  }, 400);
};

const handleKeydown = (event: KeyboardEvent) => {
  // Send on Enter (without Shift)
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleSend();
    return;
  }

  // Shake counter when at limit and user tries to type a printable character
  if (
    messageText.value.length >= MAX_LENGTH &&
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    triggerShake();
  }
};

const handleFile = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // picking the same file again fires change again
  if (!file || !props.isReady) return;
  pendingFile.value = file;
  textareaRef.value?.focus();
};

const removeFile = () => {
  pendingFile.value = null;
  textareaRef.value?.focus();
};

const handleSend = () => {
  if (!canSend.value) return;

  if (pendingFile.value) emit("attach", pendingFile.value, messageText.value);
  else emit("send", messageText.value);
  emit("stopTyping");
  messageText.value = "";
  pendingFile.value = null;

  nextTick(() => {
    if (textareaRef.value) textareaRef.value.style.height = "auto";
  });
};

defineExpose({ focus: () => textareaRef.value?.focus() });
</script>

<style>
.hay-composer {
  position: relative;
}

.hay-composer__counter {
  position: absolute;
  top: -18px;
  right: 4px;
  font-size: 11px;
  color: var(--hay-meta);
  line-height: 1;
}

.hay-composer__counter--danger {
  color: var(--hay-danger);
  font-weight: 600;
}

.hay-composer__counter--shake {
  animation: hay-shake 0.4s ease;
}

@keyframes hay-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-3px);
  }
  40% {
    transform: translateX(3px);
  }
  60% {
    transform: translateX(-2px);
  }
  80% {
    transform: translateX(2px);
  }
}

.hay-counter-enter-active,
.hay-counter-leave-active {
  transition:
    opacity 0.35s ease,
    transform 0.35s ease;
}

.hay-counter-enter-from,
.hay-counter-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

.hay-composer__error {
  margin: 0 4px 6px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--hay-danger);
}

.hay-composer__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 6px 6px 8px;
  border: 1px solid var(--hay-line);
  border-radius: 16px;
  background: var(--hay-surface);
}

.hay-composer__field:focus-within {
  border-color: var(--hay-accent);
}

.hay-composer__row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.hay-composer__textarea {
  flex: 1;
  min-width: 0;
  /* Four 20px lines at most; centred against the 34px buttons on one line. */
  max-height: 94px;
  padding: 7px 0;
  border: 0;
  outline: 0;
  resize: none;
  overflow-y: auto;
  background: transparent;
  font-size: 14px;
  line-height: 20px;
}

#hay-webchat-root .hay-composer__textarea:focus-visible {
  outline: none;
}

.hay-composer__textarea::placeholder {
  color: var(--hay-meta);
}

.hay-composer__textarea:disabled {
  cursor: not-allowed;
}

.hay-composer__attach,
.hay-composer__send {
  flex: none;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
}

.hay-composer__attach {
  width: 32px;
  height: 34px;
  border-radius: 8px;
  background: transparent;
  color: var(--hay-meta);
}

.hay-composer__attach:hover:not(:disabled) {
  color: var(--hay-text);
}

.hay-composer__send {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  background: var(--hay-brand);
  color: var(--hay-on-brand);
  transition: opacity 0.15s ease;
}

.hay-composer__send:disabled {
  opacity: 0.4;
  cursor: default;
}

.hay-composer__attach:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hay-composer__file {
  display: none;
}

.hay-composer__chip {
  display: flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  max-width: 100%;
  padding: 4px 4px 4px 9px;
  border-radius: 10px;
  background: var(--hay-bubble);
  color: var(--hay-text);
  font-size: 12.5px;
}

.hay-composer__chip-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.hay-composer__chip-size {
  flex: none;
  color: var(--hay-meta);
}

.hay-composer__chip-remove {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--hay-meta);
}

.hay-composer__chip-remove:hover {
  color: var(--hay-text);
}

/* Phones: 44px targets */
@media (max-width: 480px) {
  .hay-composer__attach,
  .hay-composer__send {
    width: 44px;
    height: 44px;
  }

  .hay-composer__textarea {
    padding: 12px 0;
    max-height: 104px;
  }

  .hay-composer__chip-remove {
    width: 44px;
    height: 44px;
  }
}
</style>
