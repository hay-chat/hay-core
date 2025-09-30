<template>
  <div class="shopify-tutorial">
    <div class="tutorial-header">
      <h3>📚 How to Connect Your Shopify Store</h3>
      <p>Follow these steps to create a custom app and get your API credentials:</p>
    </div>

    <div class="tutorial-steps">
      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">1</span>
          <h4>Access Settings</h4>
        </div>
        <p>
          From your Shopify admin dashboard, click on the "Settings" button in the bottom left
          corner of the sidebar.
        </p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-shopify'}/images/S00001.png`"
          alt="Shopify Settings Access"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">2</span>
          <h4>Navigate to Apps and Sales Channels</h4>
        </div>
        <p>
          In the Settings menu, search for "apps" in the search bar and click on "Apps and sales
          channels".
        </p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-shopify'}/images/S00002.png`"
          alt="Apps and Sales Channels Navigation"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">3</span>
          <h4>View Installed Apps</h4>
        </div>
        <p>You'll see a list of your installed apps. We'll create a custom app for Hay integration.</p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-shopify'}/images/S00003.png`"
          alt="Installed Apps List"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">4</span>
          <h4>Enable App Development</h4>
        </div>
        <p>
          Go to "App development" in Settings and click "Allow legacy custom app development" to
          enable custom app creation.
        </p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-shopify'}/images/S00004.png`"
          alt="App Development Settings"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">5</span>
          <h4>Confirm Custom App Development</h4>
        </div>
        <p>
          A confirmation dialog will appear. Click "Allow custom app development" to proceed. Note
          that this action cannot be undone.
        </p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-shopify'}/images/S00005.png`"
          alt="Confirm Custom App Development"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">6</span>
          <h4>Create Legacy Custom App</h4>
        </div>
        <p>After enabling custom app development, click "Create a legacy custom app".</p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-shopify'}/images/S00006.png`"
          alt="Create Legacy Custom App"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">7</span>
          <h4>Name Your App</h4>
        </div>
        <p>
          In the "Create an app" dialog, enter "Hay" as the app name and select an app developer.
          Then click "Create app".
        </p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-shopify'}/images/S00007.png`"
          alt="Name Your App"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">8</span>
          <h4>View App Overview</h4>
        </div>
        <p>
          Your app will be created. You'll see the app overview page with tabs for Overview,
          Configuration, API credentials, and App settings.
        </p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-shopify'}/images/S00008.png`"
          alt="App Overview"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">9</span>
          <h4>Configure Admin API Scopes</h4>
        </div>
        <p>
          Go to the "Configuration" tab and click "Configure Admin API scopes". Select all the API
          scopes that your integration needs to access your store data.
        </p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-shopify'}/images/S00009.png`"
          alt="Configure Admin API Scopes"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">10</span>
          <h4>Install the App</h4>
        </div>
        <p>
          Navigate to the "API credentials" tab and click "Install app" to generate your access
          token.
        </p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-shopify'}/images/S00010.png`"
          alt="Install App"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">11</span>
          <h4>Confirm App Installation</h4>
        </div>
        <p>
          A confirmation dialog will appear explaining that the app will have access to your data
          based on the selected scopes. Click "Install" to proceed.
        </p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-shopify'}/images/S00011.png`"
          alt="Confirm App Installation"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">12</span>
          <h4>View Access Token</h4>
        </div>
        <p>
          After installation, you'll see the "Admin API access token" section. Click "Reveal token
          once" to view your access token. Important: You can only reveal this token once, so make
          sure to copy it immediately.
        </p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-shopify'}/images/S00012.png`"
          alt="View Access Token"
          class="step-image"
        />
      </div>

      <div class="tutorial-step">
        <div class="step-header">
          <span class="step-number">13</span>
          <h4>Copy Your Access Token</h4>
        </div>
        <p>
          Copy the revealed Admin API access token and paste it into the "<a href="#shopifyAccessToken"
            >Shopify Access Token</a
          >" field in the settings above. Your store URL should be in the format:
          <code>your-store-name.myshopify.com</code>
        </p>
        <img
          :src="`${apiBaseUrl || 'http://localhost:3001'}/plugins/public/${plugin?.id || 'hay-plugin-shopify'}/images/S00013.png`"
          alt="Copy Access Token"
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
          <strong>Important:</strong> Keep your access token secure and never share it publicly.
          The token can only be revealed once - if you lose it, you'll need to uninstall and
          reinstall the app to generate a new one. Store the token in a secure location
          immediately after copying it.
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "ShopifyAfterSettings",
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

.tutorial-step code {
  background: #f3f4f6;
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.875rem;
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
  .shopify-tutorial {
    padding: 1rem;
  }

  .tutorial-step {
    padding: 0.75rem;
  }
}
</style>
