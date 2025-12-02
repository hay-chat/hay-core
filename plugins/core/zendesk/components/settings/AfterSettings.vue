<template>
  <div class="zendesk-tutorial">
    <div class="tutorial-header">
      <h3>📚 How to Find Your Zendesk Credentials</h3>
      <p>Follow these steps to locate your API credentials in Zendesk:</p>
    </div>

    <div class="tutorial-steps">
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">1</span>
          <h4>Access Admin Center</h4>
        </div>
        <p>
          Navigate to your Zendesk Admin Center by clicking on the settings gear icon in the
          sidebar. Then navigate to "Apps and integrations", select "APIs" → "API tokens", and click
          "Add API token"
        </p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-zendesk'}/images/Z00001.png`"
          alt="Zendesk Admin Center Access"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">2</span>
          <h4>Generate API Token</h4>
        </div>
        <p>Write a description (like "Hay AI Agent") for the token and click "Create token".</p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-zendesk'}/images/Z00002.png`"
          alt="Zendesk API Settings"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">3</span>
          <h4>Copy the API Token</h4>
        </div>
        <p>
          Copy the API token and paste it into the "<a href="#zendeskApiToken">Zendesk API Token</a
          >" field in this settings page.
        </p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-zendesk'}/images/Z00003.png`"
          alt="Generate Zendesk API Token"
          class="step-image"
        />
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
          <strong>Important:</strong> Keep your API token secure and never share it publicly. You
          can revoke and regenerate tokens at any time from the Zendesk Admin Center.
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "ZendeskBeforeSettings",
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
  margin: 0 0 1rem 0;
  line-height: 1.5;
}

.step-image {
  width: 100%;
  height: auto;
  border-radius: 6px;
  box-shadow:
    0 1px 3px 0 rgba(0, 0, 0, 0.1),
    0 1px 2px 0 rgba(0, 0, 0, 0.06);
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

/* Responsive design */
@media (max-width: 640px) {
  .zendesk-tutorial {
    padding: 1rem;
  }

  .tutorial-step {
    padding: 0.75rem;
  }
}
</style>
