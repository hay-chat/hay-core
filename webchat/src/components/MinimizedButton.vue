<template>
  <button
    @click="$emit('toggle')"
    class="hay-chat-button"
    :class="{ 'hay-chat-button--left': position === 'left' }"
    aria-label="Open chat"
  >
    <svg
      v-if="!isOpen"
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
    <svg
      v-else
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
    <span v-if="unreadCount > 0" class="hay-chat-button__badge">{{ unreadCount }}</span>
  </button>
</template>

<script setup lang="ts">
defineProps<{
  isOpen: boolean;
  position: 'left' | 'right';
  unreadCount: number;
}>();

defineEmits<{
  toggle: [];
}>();
</script>

<style scoped>
.hay-chat-button {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: var(--hay-primary);
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  transition: all 0.3s ease;
  z-index: 999999;
}

.hay-chat-button:hover {
  background: var(--hay-primary-dark);
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
}

.hay-chat-button--left {
  left: 20px;
  right: auto;
}

.hay-chat-button__badge {
  position: absolute;
  top: -5px;
  right: -5px;
  background: #ef4444;
  color: white;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  border: 2px solid white;
}
</style>
