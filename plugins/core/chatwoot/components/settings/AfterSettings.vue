<template>
  <div class="chatwoot-setup-guide">
    <div class="tutorial-header">
      <h3>Chatwoot Setup Guide</h3>
      <p>
        Connect a Chatwoot Agent Bot to Hay. The bot receives every incoming message on the inboxes
        you assign it to, routes them through Hay's AI, and only escalates to a human when the
        orchestrator decides a handoff is needed.
      </p>
    </div>

    <div class="tutorial-steps">
      <!-- Step 1: Generate a webhook secret -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">1</span>
          <h4>Choose a Webhook Secret</h4>
        </div>
        <p>
          Generate a random string (20+ characters) and paste it in the
          <strong>Webhook Secret</strong> field above. This is what authenticates inbound webhooks
          from your Chatwoot instance — anyone who knows this secret can push messages into your Hay
          workspace, so treat it like a password.
        </p>
      </div>

      <!-- Step 2: Create an Agent Bot in Chatwoot -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">2</span>
          <h4>Create an Agent Bot in Chatwoot</h4>
        </div>
        <p>
          In your Chatwoot instance, navigate to <strong>Settings &rarr; Agent Bots</strong> and
          click <strong>Add Agent Bot</strong>. Give it a name (e.g. "Hay AI") and set the
          <strong>Bot Outgoing URL</strong> to:
        </p>
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
          After saving the bot, Chatwoot shows an <code>access_token</code>. Copy it and paste it in
          the <strong>Agent Bot Access Token</strong> field above. This token is the bot's
          credential — store it safely.
        </p>
      </div>

      <!-- Step 3: Base URL & Account ID -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">3</span>
          <h4>Paste Base URL &amp; Account ID</h4>
        </div>
        <p>
          Set <strong>Chatwoot Base URL</strong> to your Chatwoot instance URL — use
          <code>https://app.chatwoot.com</code> for Chatwoot Cloud, or your self-hosted URL (e.g.
          <code>https://chat.example.com</code>).
        </p>
        <p>
          Your <strong>Account ID</strong> is the number in your Chatwoot dashboard URL, for example
          <code>https://app.chatwoot.com/app/accounts/<strong>12345</strong>/…</code>.
        </p>
      </div>

      <!-- Step 4: Assign bot to an inbox -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">4</span>
          <h4>Assign the Bot to an Inbox</h4>
        </div>
        <p>
          In Chatwoot, go to <strong>Settings &rarr; Inboxes</strong>, pick the inbox you want Hay
          to handle, open <strong>Configuration &rarr; Bot Configuration</strong>, and select your
          bot. New conversations on that inbox will open in <code>pending</code> state — that's the
          bot's triage window. Your customers can chat, Hay responds, and humans only get notified
          when Hay escalates.
        </p>
      </div>

      <!-- Step 5: Optional escalation team -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">5</span>
          <h4>(Optional) Set an Escalation Team</h4>
        </div>
        <p>
          If you set <strong>Escalation Team ID</strong> above, Hay will automatically assign
          escalated conversations to that team in Chatwoot. Find the team ID in
          <strong>Settings &rarr; Teams</strong> — it's the number in the URL when you open a team's
          settings. Leave blank to let Chatwoot's default routing take over.
        </p>
      </div>

      <!-- Step 6: Test -->
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">6</span>
          <h4>Test the Connection</h4>
        </div>
        <p>
          Send a message to the inbox you assigned the bot to (use the Chatwoot live chat widget or
          your customer-facing surface). You should see a new conversation appear in the Hay inbox
          and the AI should reply inside Chatwoot within a few seconds.
        </p>
        <p class="hint">
          To assign a specific Hay agent to the Chatwoot channel, go to
          <strong>Settings &rarr; Channels</strong> and pick an agent for the
          <code>chatwoot</code> channel.
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
          <strong>How handoff works:</strong> When Hay's orchestrator decides to escalate (e.g.
          low-confidence response, policy guardrail), Hay will post an internal note in the Chatwoot
          conversation with the handoff reason, move the conversation out of the bot's
          <code>pending</code> state into <code>open</code>, and (optionally) assign it to your
          escalation team. Replies from a Chatwoot human agent are propagated back to Hay so the
          conversation history stays in sync.
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";

export default defineComponent({
  name: "ChatwootAfterSettings",
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

    // Matches the generic plugin proxy route: /v1/plugins/{pluginId}/{path}?organizationId=...
    // We append &secret=... so the plugin's /messages handler can verify inbound requests.
    const webhookUrl = computed(() => {
      const base = props.apiBaseUrl || "http://localhost:3001";
      const pluginId = props.plugin?.id || "hay-channel-chatwoot";
      const orgId = props.config?.organizationId || "YOUR_ORG_ID";
      const secret = props.config?.webhookSecret || "YOUR_WEBHOOK_SECRET";
      return `${base}/v1/plugins/${encodeURIComponent(pluginId)}/messages?organizationId=${orgId}&secret=${encodeURIComponent(secret)}`;
    });

    const copyWebhookUrl = async () => {
      try {
        await navigator.clipboard.writeText(webhookUrl.value);
        copied.value = true;
        setTimeout(() => {
          copied.value = false;
        }, 2000);
      } catch {
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
  .chatwoot-setup-guide {
    padding: 1rem;
  }
}
</style>
