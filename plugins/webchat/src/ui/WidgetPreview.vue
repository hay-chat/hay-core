<template>
  <div class="widget-preview-container">
    <div :class="['widget-preview', `position-${position}`, `theme-${theme}`]">
      <!-- Chat Button -->
      <div class="preview-button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
        </svg>
      </div>

      <!-- Chat Window -->
      <div class="preview-window">
        <div class="preview-header">
          <div>
            <div class="preview-title">{{ config.widgetTitle || 'Chat with us' }}</div>
            <div class="preview-subtitle">{{ config.widgetSubtitle || '' }}</div>
          </div>
          <svg class="preview-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </div>
        
        <div class="preview-messages">
          <div v-if="config.showGreeting" class="preview-message agent">
            <div class="preview-bubble">
              {{ config.greetingMessage || 'Hello! How can we help you today?' }}
            </div>
          </div>
          <div class="preview-message user">
            <div class="preview-bubble">
              Hi, I need help with my order
            </div>
          </div>
          <div class="preview-message agent">
            <div class="preview-bubble">
              I'd be happy to help! Could you provide your order number?
            </div>
          </div>
        </div>
        
        <div class="preview-input">
          <input type="text" placeholder="Type your message..." disabled />
          <button class="preview-send">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>;
  theme: string;
  position: string;
}>();
</script>

<style scoped>
.widget-preview-container {
  width: 100%;
  height: 400px;
  position: relative;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
  overflow: hidden;
}

.widget-preview {
  position: absolute;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}

.widget-preview.position-right {
  right: 20px;
}

.widget-preview.position-left {
  left: 20px;
  align-items: flex-start;
}

/* Preview Button */
.preview-button {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--preview-primary, #3B82F6);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.preview-button svg {
  width: 24px;
  height: 24px;
}

/* Preview Window */
.preview-window {
  width: 280px;
  height: 350px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-header {
  background: var(--preview-primary, #3B82F6);
  color: white;
  padding: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.preview-title {
  font-size: 14px;
  font-weight: 600;
}

.preview-subtitle {
  font-size: 11px;
  opacity: 0.9;
  margin-top: 2px;
}

.preview-close {
  width: 20px;
  height: 20px;
  cursor: pointer;
  opacity: 0.8;
}

/* Messages */
.preview-messages {
  flex: 1;
  padding: 12px;
  background: #F9FAFB;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-message {
  display: flex;
}

.preview-message.user {
  justify-content: flex-end;
}

.preview-message.agent {
  justify-content: flex-start;
}

.preview-bubble {
  max-width: 70%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.4;
}

.preview-message.user .preview-bubble {
  background: var(--preview-primary, #3B82F6);
  color: white;
  border-bottom-right-radius: 4px;
}

.preview-message.agent .preview-bubble {
  background: white;
  color: #1F2937;
  border-bottom-left-radius: 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

/* Input */
.preview-input {
  padding: 10px;
  background: white;
  border-top: 1px solid #E5E7EB;
  display: flex;
  gap: 6px;
}

.preview-input input {
  flex: 1;
  padding: 6px 12px;
  border: 1px solid #D1D5DB;
  border-radius: 20px;
  font-size: 12px;
  background: #F9FAFB;
}

.preview-send {
  width: 32px;
  height: 32px;
  border: none;
  background: var(--preview-primary, #3B82F6);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.preview-send svg {
  width: 16px;
  height: 16px;
}

/* Theme Variations */
.theme-blue {
  --preview-primary: #3B82F6;
}

.theme-green {
  --preview-primary: #10B981;
}

.theme-purple {
  --preview-primary: #8B5CF6;
}

.theme-black {
  --preview-primary: #000000;
}
</style>