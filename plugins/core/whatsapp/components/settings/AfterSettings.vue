<template>
  <div class="whatsapp-setup-guide">
    <div class="tutorial-header">
      <h3>WhatsApp Setup Guide (Twilio)</h3>
      <p>Follow these steps to connect WhatsApp to your Hay workspace.</p>
    </div>

    <div class="tutorial-steps">
      <!-- Step 1: Twilio account -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">1</span>
          <h4>Create a Twilio Account</h4>
        </div>
        <p>
          Sign up or log in at
          <a href="https://www.twilio.com/console" target="_blank" rel="noopener"
            >console.twilio.com</a
          >. Copy your <strong>Account SID</strong> and <strong>Auth Token</strong> from the
          dashboard and paste them into the fields above.
        </p>
      </div>

      <!-- Step 2: Enable WhatsApp Sandbox (dev) or register number (prod) -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">2</span>
          <h4>Enable WhatsApp</h4>
        </div>
        <p>
          <strong>For development:</strong> Go to
          <a
            href="https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn"
            target="_blank"
            rel="noopener"
          >
            Messaging &rarr; Try it out &rarr; Send a WhatsApp message
          </a>
          and activate the sandbox. Follow the instructions to join with your phone.
        </p>
        <p>
          <strong>For production:</strong> Register a WhatsApp sender in
          <a
            href="https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders"
            target="_blank"
            rel="noopener"
          >
            Messaging &rarr; Senders &rarr; WhatsApp senders
          </a>
          and complete Meta's business verification.
        </p>
        <p>
          Enter the WhatsApp-enabled phone number (e.g., <code>+14155238886</code>) in the
          <strong>WhatsApp Number</strong> field above.
        </p>
      </div>

      <!-- Step 3: Configure webhook URL -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">3</span>
          <h4>Configure the Webhook URL</h4>
        </div>
        <p>In Twilio Console, set the <strong>"When a message comes in"</strong> webhook URL to:</p>
        <div class="webhook-url-box">
          <code class="webhook-url">{{ webhookUrl }}</code>
          <button class="copy-btn" @click="copyWebhookUrl" :title="copyLabel">
            <svg
              v-if="!copied"
              class="copy-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
              />
            </svg>
            <svg
              v-else
              class="copy-icon check"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </button>
        </div>
        <p class="hint">
          For the <strong>sandbox</strong>, set this in the sandbox configuration page. For
          <strong>production</strong>, set it in your WhatsApp sender settings.
        </p>
      </div>

      <!-- Step 4: Test -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">4</span>
          <h4>Test the Connection</h4>
        </div>
        <p>
          Send a WhatsApp message to your Twilio number. You should see a new conversation appear in
          the Hay inbox. The AI agent assigned to the WhatsApp channel will respond automatically.
        </p>
        <p class="hint">
          To assign an agent to WhatsApp, go to
          <strong>Settings &rarr; Channels</strong> and select an agent for the WhatsApp channel.
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
          <strong>24-hour session window:</strong> WhatsApp requires businesses to respond within 24
          hours of the customer's last message. After 24 hours, the conversation is automatically
          closed and the customer must send a new message to restart.
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";

export default defineComponent({
  name: "WhatsAppAfterSettings",
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
  setup(props) {
    const copied = ref(false);
    const copyLabel = computed(() => (copied.value ? "Copied!" : "Copy to clipboard"));

    const webhookUrl = computed(() => {
      const base = props.apiBaseUrl || "http://localhost:3001";
      const pluginId = props.plugin?.id || "hay-channel-whatsapp-twilio";
      // Uses the plugin proxy route which requires organizationId query param
      const orgId = props.config?.organizationId || "YOUR_ORG_ID";
      return `${base}/v1/plugins/${encodeURIComponent(pluginId)}/webhook?organizationId=${orgId}`;
    });

    const copyWebhookUrl = async () => {
      try {
        await navigator.clipboard.writeText(webhookUrl.value);
        copied.value = true;
        setTimeout(() => {
          copied.value = false;
        }, 2000);
      } catch {
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = webhookUrl.value;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        copied.value = true;
        setTimeout(() => {
          copied.value = false;
        }, 2000);
      }
    };

    return { webhookUrl, copyWebhookUrl, copied, copyLabel };
  },
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

.webhook-url-box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  margin-bottom: 0.75rem;
}

.webhook-url {
  flex: 1;
  font-size: 0.8125rem;
  word-break: break-all;
  background: transparent;
  padding: 0;
}

.copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
}

.copy-btn:hover {
  background: #f3f4f6;
}

.copy-icon {
  width: 16px;
  height: 16px;
  color: #6b7280;
}

.copy-icon.check {
  color: #059669;
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
  .whatsapp-setup-guide {
    padding: 1rem;
  }
}
</style>
