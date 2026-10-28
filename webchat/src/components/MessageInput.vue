<template>
  <div class="hay-message-input">
    <p v-if="failure" class="hay-message-input__error" role="alert">
      {{ t(FAILURE_KEYS[failure.reason]) }}
    </p>
    <Transition name="hay-counter">
      <span
        v-if="messageText.length > 750"
        class="hay-message-input__counter"
        :class="{
          'hay-message-input__counter--danger': messageText.length > 900,
          'hay-message-input__counter--shake': isShaking,
        }"
      >
        {{ messageText.length }}/{{ MAX_LENGTH }}
      </span>
    </Transition>
    <div class="hay-message-input__wrapper">
      <button
        type="button"
        @click="fileInputRef?.click()"
        :disabled="!isReady"
        class="hay-message-input__attach"
        :aria-label="t('input.attach')"
        :title="t('input.attach')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path
            d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
          ></path>
        </svg>
      </button>
      <input
        ref="fileInputRef"
        type="file"
        :accept="WIDGET_ATTACHMENT_ACCEPT"
        class="hay-message-input__file"
        tabindex="-1"
        aria-hidden="true"
        @change="handleFile"
      />
      <textarea
        v-model="messageText"
        @keydown="handleKeydown"
        @input="handleInput"
        :placeholder="t('input.placeholder')"
        rows="1"
        ref="textareaRef"
        :disabled="!isReady"
        :maxlength="MAX_LENGTH"
        class="hay-message-input__textarea"
      ></textarea>
      <button
        @click="handleSend"
        :disabled="!messageText.trim() || !isReady"
        class="hay-message-input__button"
        :aria-label="t('input.send')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="19" x2="12" y2="5"></line>
          <polyline points="5 12 12 5 19 12"></polyline>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from "vue";
import { useI18n } from "@/i18n";
import type { SendFailure } from "@/types";
import type { TranslationKey } from "@/i18n";
import { WIDGET_ATTACHMENT_ACCEPT } from "@/utils/attachments";

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
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

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

// The typed text goes with the file as its caption.
const handleFile = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // picking the same file again fires change again
  if (!file || !props.isReady) return;

  emit("attach", file, messageText.value);
  emit("stopTyping");
  messageText.value = "";
  nextTick(() => {
    if (textareaRef.value) textareaRef.value.style.height = "auto";
  });
};

const handleSend = () => {
  if (!messageText.value.trim() || !props.isReady) return;

  emit("send", messageText.value);
  emit("stopTyping");
  messageText.value = "";

  // Reset textarea height
  nextTick(() => {
    if (textareaRef.value) {
      textareaRef.value.style.height = "auto";
    }
  });
};
</script>

<style scoped>
.hay-message-input {
  padding-inline: 16px;
  position: relative;
}

.hay-message-input__counter {
  position: absolute;
  top: -18px;
  right: 16px;
  font-size: 11px;
  color: var(--color-neutral-400);
  line-height: 1;
}

.hay-message-input__error {
  margin: 0 0 6px;
  font-size: 12px;
  line-height: 1.4;
  color: #b91c1c;
}

.hay-message-input__counter--danger {
  color: #ef4444;
  font-weight: 600;
}

.hay-message-input__counter--shake {
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

.hay-message-input__wrapper {
  display: flex;
  align-items: center;
  background: var(--color-neutral-100);
  border-radius: 8px;
  padding: 4px 4px 4px 4px;
  transition: border-color 0.2s;
  gap: 4px;
}

.hay-message-input__wrapper:focus-within {
  border-color: var(--hay-primary);
  box-shadow: 0 0 0 2px var(--hay-primary);
  background: transparent;
}

.hay-message-input__textarea {
  flex: 1;
  border: none;
  padding: 6px 0;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  max-height: 120px;
  overflow-y: auto;
  outline: none;
  background: transparent;
}

.hay-message-input__textarea:focus {
  outline: none !important;
}

.hay-message-input__textarea:disabled {
  background: transparent;
  cursor: not-allowed;
}

.hay-message-input__button {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: var(--hay-primary);
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
  align-self: flex-end;
}

.hay-message-input__button:hover:not(:disabled) {
  background: var(--hay-primary-dark);
}

.hay-message-input__attach {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: var(--color-neutral-500, #64748b);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  align-self: flex-end;
}

.hay-message-input__attach:hover:not(:disabled) {
  color: var(--hay-primary);
}

.hay-message-input__attach:disabled {
  color: var(--color-neutral-400);
  cursor: not-allowed;
}

.hay-message-input__file {
  display: none;
}

.hay-message-input__button:disabled {
  background: transparent;
  color: var(--color-neutral-400);
  cursor: not-allowed;
}
</style>
