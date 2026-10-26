<template>
  <div class="email-setup">
    <div class="setup-header">
      <h3>{{ t("title") }}</h3>
      <p>{{ t("intro") }}</p>
    </div>

    <p v-if="loading && !status" class="muted" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      {{ t("loadingStatus") }}
    </p>

    <div v-if="statusError" class="notice notice-error" role="alert">
      <div>
        <strong>{{ t("statusError.title") }}</strong>
        <p>{{ statusError === NO_API ? t("statusError.noApi") : t("statusError.body") }}</p>
        <p v-if="statusError !== NO_API" class="small">
          {{ t("statusError.detail", { message: statusError }) }}
        </p>
      </div>
      <button type="button" class="btn btn-outline" :disabled="loading" @click="loadStatus()">
        {{ t("statusError.retry") }}
      </button>
    </div>

    <template v-if="status">
      <div v-if="missingHost.length" class="notice notice-warning" role="alert">
        <div>
          <strong>{{ t("notReady.title") }}</strong>
          <p class="small">{{ t("notReady.body", { missing: missingHost.join(", ") }) }}</p>
        </div>
      </div>

      <div v-else-if="!status.supportAddress" class="notice notice-warning" role="status">
        <div>
          <strong>{{ t("needsAddress.title") }}</strong>
          <p class="small">{{ t("needsAddress.body") }}</p>
        </div>
      </div>

      <!-- Forwarding address -->
      <section v-if="status.alias" class="card" aria-labelledby="email-address-title">
        <div class="card-header">
          <h4 id="email-address-title">{{ t("address.title") }}</h4>
        </div>
        <p class="body">{{ t("address.intro") }}</p>
        <div class="url-box">
          <code class="url" data-testid="email-forwarding-address">{{ status.alias }}</code>
          <button
            type="button"
            class="copy-btn"
            :aria-label="t('address.copy')"
            :title="copied ? t('address.copied') : t('address.copy')"
            @click="copy(status.alias)"
          >
            {{ copied ? t("address.copied") : t("address.copy") }}
          </button>
        </div>
        <dl class="facts">
          <div v-if="status.fromAddress">
            <dt>{{ t("address.from") }}</dt>
            <dd>{{ status.storeName }} &lt;{{ status.fromAddress }}&gt;</dd>
          </div>
          <div v-if="status.replyToExample">
            <dt>{{ t("address.replyTo") }}</dt>
            <dd>
              <code class="inline">{{ status.replyToExample }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ t("address.archive") }}</dt>
            <dd>
              {{
                status.bccArchive && status.supportAddress
                  ? t("address.archiveOn", { address: status.supportAddress })
                  : t("address.archiveOff")
              }}
            </dd>
          </div>
        </dl>
      </section>

      <!-- Steps -->
      <section v-if="status.alias" class="card" aria-labelledby="email-steps-title">
        <div class="card-header">
          <h4 id="email-steps-title">{{ t("steps.title") }}</h4>
        </div>
        <ol class="steps">
          <li v-for="(step, index) in STEPS" :key="step" class="step">
            <div class="step-header">
              <span class="step-number" aria-hidden="true">{{ index + 1 }}</span>
              <h5>{{ t(`steps.${step}.title`) }}</h5>
            </div>
            <p class="body">{{ t(`steps.${step}.body`) }}</p>
          </li>
        </ol>
      </section>

      <!-- Gmail confirmation -->
      <section
        v-if="status.alias && status.supportAddress"
        class="card"
        aria-labelledby="email-confirmation-title"
        data-testid="email-confirmation-card"
      >
        <div class="card-header">
          <h4 id="email-confirmation-title">{{ t("confirmation.title") }}</h4>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            :disabled="loading"
            @click="loadStatus({ quiet: true })"
          >
            <span v-if="loading" class="spinner" aria-hidden="true"></span>
            {{ t("health.refresh") }}
          </button>
        </div>
        <p v-if="!status.forwarding" class="muted" role="status" aria-live="polite">
          <span class="spinner" aria-hidden="true"></span>
          {{ t("confirmation.waiting") }}
        </p>
        <template v-else>
          <p class="success-line">
            {{ t("confirmation.received", { time: formatTime(status.forwarding.receivedAt) }) }}
          </p>
          <div v-if="status.forwarding.code" class="url-box">
            <span class="small">{{ t("confirmation.code") }}</span>
            <code class="url" data-testid="email-forwarding-code">{{
              status.forwarding.code
            }}</code>
            <button type="button" class="copy-btn" @click="copy(status.forwarding.code)">
              {{ copied ? t("address.copied") : t("confirmation.copyCode") }}
            </button>
          </div>
          <p v-else class="notice notice-warning small">{{ t("confirmation.noCode") }}</p>
          <p v-if="status.forwarding.link" class="small">
            <a :href="status.forwarding.link" target="_blank" rel="noopener noreferrer">
              {{ t("confirmation.link") }}
            </a>
          </p>
        </template>
      </section>

      <!-- Health -->
      <section v-if="status.alias" class="card" aria-labelledby="email-health-title">
        <div class="card-header">
          <h4 id="email-health-title">{{ t("health.title") }}</h4>
        </div>
        <dl class="facts">
          <div>
            <dt>{{ t("health.lastInbound") }}</dt>
            <dd>
              {{ status.lastInboundAt ? formatTime(status.lastInboundAt) : t("health.never") }}
            </dd>
          </div>
          <div>
            <dt>{{ t("health.count") }}</dt>
            <dd>{{ status.inboundCount }}</dd>
          </div>
          <div v-if="status.lastError">
            <dt>{{ t("health.lastError") }}</dt>
            <dd class="small">{{ status.lastError }}</dd>
          </div>
        </dl>
      </section>
    </template>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from "vue";
import type { ChannelStatus } from "../../src/status";
import { createTranslator } from "./messages";

/** The slice of the dashboard tRPC client (`Hay`) this component uses. */
interface HayApi {
  plugins: {
    callUiRoute: {
      mutate(input: {
        pluginId: string;
        method: "GET" | "POST";
        path: string;
        body?: Record<string, unknown>;
      }): Promise<{ status: number; data: unknown }>;
    };
  };
}

const STEPS = ["gmail", "outlook", "other", "test"];
const NO_API = "no-api";
/** Poll for the Gmail confirmation / first inbound while the page is open. */
const POLL_INTERVAL_MS = 8000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isChannelStatus(value: unknown): value is ChannelStatus {
  return typeof value === "object" && value !== null && "configured" in value && "missing" in value;
}

export default defineComponent({
  name: "EmailAfterSettings",
  props: {
    plugin: {
      type: Object as PropType<{ id?: string }>,
      default: () => ({}),
    },
    config: {
      type: Object as PropType<Record<string, unknown>>,
      default: () => ({}),
    },
    apiBaseUrl: {
      type: String,
      default: "http://localhost:3001",
    },
    api: {
      type: Object as PropType<HayApi>,
      default: undefined,
    },
    locale: {
      type: String,
      default: "en",
    },
  },
  setup(props) {
    const translator = computed(() => createTranslator(props.locale));
    const t = (key: string, params?: Record<string, string | number>) =>
      translator.value(key, params);

    const pluginId = computed(() => props.plugin?.id || "hay-channel-email");
    const status = ref<ChannelStatus | null>(null);
    const statusError = ref<string | null>(null);
    const loading = ref(false);
    const copied = ref(false);
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const missingHost = computed(() =>
      (status.value?.missing ?? []).filter((name) => name !== "supportAddress"),
    );

    async function loadStatus(options: { quiet?: boolean } = {}) {
      if (!props.api) {
        statusError.value = NO_API;
        return;
      }
      loading.value = true;
      if (!options.quiet) {
        statusError.value = null;
      }
      try {
        const response = await props.api.plugins.callUiRoute.mutate({
          pluginId: pluginId.value,
          method: "GET",
          path: "/ui/status",
        });
        if (!isChannelStatus(response.data)) {
          throw new Error(`Unexpected status payload (HTTP ${response.status})`);
        }
        status.value = response.data;
        statusError.value = null;
      } catch (error: unknown) {
        if (!options.quiet || !status.value) {
          statusError.value = errorMessage(error);
        }
      } finally {
        loading.value = false;
      }
    }

    async function copy(value: string | undefined) {
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        copied.value = true;
        setTimeout(() => {
          copied.value = false;
        }, 2000);
      } catch {
        copied.value = false;
      }
    }

    function formatTime(iso: string): string {
      try {
        return new Intl.DateTimeFormat(props.locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(iso));
      } catch {
        return iso;
      }
    }

    onMounted(() => {
      void loadStatus();
      pollTimer = setInterval(() => {
        // Keep polling until the first email arrived; afterwards the page is informational.
        if (status.value && (status.value.forwarding || status.value.inboundCount > 0)) {
          return;
        }
        void loadStatus({ quiet: true });
      }, POLL_INTERVAL_MS);
    });

    onBeforeUnmount(() => {
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    });

    return {
      STEPS,
      NO_API,
      t,
      status,
      statusError,
      loading,
      copied,
      missingHost,
      loadStatus,
      copy,
      formatTime,
    };
  },
});
</script>

<style scoped>
.email-setup {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.setup-header {
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 1rem;
}

.setup-header h3 {
  font-size: 1.25rem;
  font-weight: 600;
  color: #111827;
  margin: 0 0 0.5rem 0;
}

.setup-header p,
.muted {
  color: #6b7280;
  font-size: 0.875rem;
  margin: 0;
}

.body {
  color: var(--color-neutral-muted);
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0 0 0.75rem 0;
}

.body :deep(code) {
  background: #f3f4f6;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-size: 0.8125rem;
}

.small {
  font-size: 0.8125rem !important;
}

.card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem 1.25rem;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.card-header h4 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem 1.5rem;
  margin: 0;
}

.facts dt {
  color: #6b7280;
  font-size: 0.75rem;
  margin-bottom: 0.125rem;
}

.facts dd {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
}

.health-errors {
  list-style: none;
  padding: 0;
  margin: 0.75rem 0 0 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.health-errors li {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-size: 0.8125rem;
  color: #991b1b;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  padding: 0.0625rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  border: 1px solid transparent;
}

.badge-success {
  background: #ecfdf5;
  color: #047857;
  border-color: #a7f3d0;
}

.badge-warning {
  background: #fffbeb;
  color: #b45309;
  border-color: #fde68a;
}

.badge-danger {
  background: #fef2f2;
  color: #b91c1c;
  border-color: #fecaca;
}

.badge-neutral {
  background: #f3f4f6;
  color: #4b5563;
  border-color: #e5e7eb;
}

.notice {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0 0 0.75rem 0;
}

.notice p {
  margin: 0.25rem 0 0 0;
}

.notice-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

.notice-warning {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
}

.success-line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #047857;
  font-size: 0.875rem;
  margin: 0 0 0.75rem 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
  cursor: pointer;
  text-decoration: none;
  border: 1px solid transparent;
  transition:
    background 0.15s,
    opacity 0.15s;
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  padding: 0.25rem 0.75rem;
  font-size: 0.8125rem;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-outline {
  background: white;
  color: #111827;
  border-color: #d1d5db;
}

.btn-outline:hover:not(:disabled) {
  background: #f3f4f6;
}

.btn:focus-visible,
.tab:focus-visible,
.copy-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid #e5e7eb;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: #6b7280;
  cursor: pointer;
}

.tab:hover {
  color: #111827;
}

.tab-selected {
  color: #111827;
  border-bottom-color: var(--color-primary);
}

.stage {
  min-height: 1.25rem;
  font-size: 0.875rem;
  color: #6b7280;
  margin: 0.75rem 0;
}

.stage-error {
  color: #b91c1c;
}

.stage-success {
  color: #047857;
}

.info-box {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 1rem;
  font-size: 0.875rem;
  line-height: 1.5;
  color: #1e40af;
}

.info-box ul {
  margin: 0.5rem 0 0 0;
  padding-left: 1.25rem;
  list-style: disc;
}

.steps {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.step-header h5 {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0;
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

.url-box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.75rem 1rem;
}

.url {
  flex: 1;
  font-size: 0.8125rem;
  word-break: break-all;
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
}

.copy-btn:hover {
  background: #f3f4f6;
}

.icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.copy-btn .icon {
  color: #6b7280;
}

.copy-btn .icon-success {
  color: #059669;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid #d1d5db;
  border-top-color: #6b7280;
  border-radius: 50%;
  animation: wa-spin 0.8s linear infinite;
  vertical-align: middle;
}

.spinner-light {
  border-color: rgba(255, 255, 255, 0.4);
  border-top-color: white;
}

@keyframes wa-spin {
  to {
    transform: rotate(360deg);
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
