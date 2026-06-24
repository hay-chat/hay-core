<template>
  <div class="instagram-setup-guide">
    <div class="tutorial-header">
      <h3>Instagram Setup Guide</h3>
      <p>
        Connect your Instagram Professional account to Hay. Once connected, direct messages sent to
        your account are routed through Hay's AI, and replies are delivered straight back to the
        Instagram thread.
      </p>
    </div>

    <div class="tutorial-steps">
      <!-- Step 1: Connect via OAuth -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">1</span>
          <h4>Connect your Instagram account</h4>
        </div>
        <p>
          Click the <strong>Connect</strong> button above to sign in with
          <strong>Facebook Login for Business</strong>. Choose the Facebook Page and the linked
          Instagram Professional account you want Hay to manage, then approve the requested
          permissions. Hay stores the connection securely &mdash; there are no tokens to copy or
          paste.
        </p>
        <p class="hint">
          You need an Instagram Professional account (Business or Creator) that is linked to a
          Facebook Page you manage.
        </p>
      </div>

      <!-- Step 2: Text-only MVP -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">2</span>
          <h4>Text-only messages (MVP)</h4>
        </div>
        <p>
          In this first release, Hay handles <strong>text</strong> direct messages only. Inbound
          media (images, stories, reactions) is ignored, and Hay's replies are sent as plain text.
          Rich content support is coming in a later update.
        </p>
      </div>

      <!-- Step 3: 24-hour window -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">3</span>
          <h4>Reply within 24 hours</h4>
        </div>
        <p>
          Instagram only lets businesses send a free-form reply within <strong>24 hours</strong> of
          the customer's last message. After that window closes, the customer must message you again
          before Hay can respond.
        </p>
      </div>

      <!-- Step 4: Where messages appear -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">4</span>
          <h4>Where messages appear</h4>
        </div>
        <p>
          Once connected, new Instagram DMs show up as conversations in your Hay inbox. The AI agent
          assigned to the Instagram channel responds automatically.
        </p>
        <p class="hint">
          To assign an agent, go to <strong>Settings &rarr; Channels</strong> and select an agent
          for the Instagram channel.
        </p>
      </div>
    </div>

    <div class="tutorial-footer">
      <div class="info-box">
        <svg
          class="info-icon"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          ></path>
        </svg>
        <div>
          <strong>24-hour messaging window:</strong> Instagram requires businesses to respond within
          24 hours of the customer's last message. After 24 hours, you must wait for the customer to
          send a new message before replying.
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "InstagramAfterSettings",
  props: {
    plugin: {
      type: Object,
      default: () => ({}),
    },
    config: {
      type: Object,
      default: () => ({}),
    },
    apiBaseUrl: {
      type: String,
      default: "http://localhost:3001",
    },
  },
  emits: ["update:config"],
});
</script>

<style scoped>
.tutorial-header {
  margin-bottom: 1.5rem;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 1rem;
}

.tutorial-header h3 {
  font-size: 1.25rem;
  font-weight: 600;
  color: #111827;
  margin: 0 0 0.5rem 0;
}

.tutorial-header p {
  color: #6b7280;
  font-size: 0.875rem;
  margin: 0;
}

.tutorial-steps {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.step-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--color-primary);
  color: white;
  border-radius: 50%;
  font-size: 0.875rem;
  font-weight: 600;
  flex-shrink: 0;
}

.step-header h4 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
}

.tutorial-step p {
  color: var(--color-neutral-muted);
  font-size: 0.875rem;
  margin: 0 0 0.75rem 0;
  line-height: 1.5;
}

.tutorial-step a {
  color: var(--color-primary);
  text-decoration: underline;
}

.tutorial-step code {
  background: #f3f4f6;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-size: 0.8125rem;
}

.hint {
  color: #9ca3af !important;
  font-size: 0.8125rem !important;
}

.tutorial-footer {
  margin-top: 1.5rem;
}

.info-box {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 1rem;
}

.info-icon {
  width: 20px;
  height: 20px;
  color: #2563eb;
  flex-shrink: 0;
  margin-top: 2px;
}

.info-box div {
  flex: 1;
  font-size: 0.875rem;
  line-height: 1.5;
  color: #1e40af;
}

.info-box strong {
  font-weight: 600;
}

@media (max-width: 640px) {
  .instagram-setup-guide {
    padding: 1rem;
  }
}
</style>
