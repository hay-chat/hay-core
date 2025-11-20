<template>
  <div class="hay-message-input">
    <textarea
      v-model="messageText"
      @keydown="handleKeydown"
      @input="handleInput"
      placeholder="Type a message..."
      rows="1"
      ref="textareaRef"
      :disabled="!isConnected"
      class="hay-message-input__textarea"
    ></textarea>
    <button
      @click="handleSend"
      :disabled="!messageText.trim() || !isConnected"
      class="hay-message-input__button"
      aria-label="Send message"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';

const props = defineProps<{
  isConnected: boolean;
}>();

const emit = defineEmits<{
  send: [message: string];
  startTyping: [];
  stopTyping: [];
}>();

const messageText = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);

const handleInput = () => {
  // Auto-resize textarea
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto';
    textareaRef.value.style.height = textareaRef.value.scrollHeight + 'px';
  }

  // Emit typing indicator
  if (messageText.value.trim()) {
    emit('startTyping');
  } else {
    emit('stopTyping');
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  // Send on Enter (without Shift)
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
};

const handleSend = () => {
  if (!messageText.value.trim() || !props.isConnected) return;

  emit('send', messageText.value);
  emit('stopTyping');
  messageText.value = '';

  // Reset textarea height
  nextTick(() => {
    if (textareaRef.value) {
      textareaRef.value.style.height = 'auto';
    }
  });
};
</script>

<style scoped>
.hay-message-input {
  display: flex;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid #e5e7eb;
  background: white;
}

.hay-message-input__textarea {
  flex: 1;
  border: 1px solid #e5e7eb;
  border-radius: 20px;
  padding: 10px 16px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  max-height: 120px;
  overflow-y: auto;
  transition: border-color 0.2s;
}

.hay-message-input__textarea:focus {
  outline: none;
  border-color: var(--hay-primary);
}

.hay-message-input__textarea:disabled {
  background: #f9fafb;
  cursor: not-allowed;
}

.hay-message-input__button {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--hay-primary);
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.hay-message-input__button:hover:not(:disabled) {
  background: var(--hay-primary-dark);
  transform: scale(1.05);
}

.hay-message-input__button:disabled {
  background: #d1d5db;
  cursor: not-allowed;
}
</style>
