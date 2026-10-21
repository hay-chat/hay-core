<template>
  <div class="whatsapp-setup">
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
      <!-- Health card -->
      <section v-if="status.connected" class="card" aria-labelledby="wa-health-title">
        <div class="card-header">
          <h4 id="wa-health-title">{{ t("health.title") }}</h4>
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

        <p v-if="status.error" class="notice notice-error small" role="alert">
          {{ t("health.lookupError", { message: status.error }) }}
        </p>

        <dl v-if="phone" class="facts">
          <div>
            <dt>{{ t("health.number") }}</dt>
            <dd>{{ phone.display_phone_number || phone.id }}</dd>
          </div>
          <div v-if="phone.verified_name">
            <dt>{{ t("health.displayName") }}</dt>
            <dd>
              {{ phone.verified_name }}
              <span v-if="phone.name_status" class="badge" :class="nameStatusTone">
                {{ label("health.nameStatus", phone.name_status) }}
              </span>
            </dd>
          </div>
          <div>
            <dt>{{ t("health.sending") }}</dt>
            <dd>
              <span class="badge" :class="canSendTone">
                {{ label("health.canSend", canSend) }}
              </span>
            </dd>
          </div>
          <div v-if="phone.quality_rating">
            <dt>{{ t("health.quality") }}</dt>
            <dd>
              <span class="badge" :class="qualityTone">
                {{ label("health.qualityRating", phone.quality_rating) }}
              </span>
            </dd>
          </div>
          <div v-if="phone.whatsapp_business_manager_messaging_limit">
            <dt>{{ t("health.limit") }}</dt>
            <dd>{{ messagingLimit }}</dd>
          </div>
          <div v-if="phone.is_on_biz_app">
            <dt>{{ t("health.coexistence") }}</dt>
            <dd>{{ t("health.coexistenceValue") }}</dd>
          </div>
        </dl>

        <ul v-if="healthErrors.length" class="health-errors">
          <li v-for="(error, index) in healthErrors" :key="index">
            <strong>{{ error.description }}</strong>
            <span v-if="error.solution">
              {{ t("health.solution", { solution: error.solution }) }}
            </span>
          </li>
        </ul>

        <p v-if="phone && phone.account_mode === 'SANDBOX'" class="notice notice-warning small">
          {{ t("health.sandbox") }}
        </p>
      </section>

      <!-- Payment card -->
      <section v-if="status.connected && status.waba" class="card" aria-labelledby="wa-pay-title">
        <div class="card-header">
          <h4 id="wa-pay-title">{{ t("payment.title") }}</h4>
        </div>
        <p v-if="status.waba.hasPaymentMethod" class="success-line">
          <svg
            class="icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
          {{ t("payment.onFile") }}
        </p>
        <template v-else>
          <p class="body">{{ t("payment.missing") }}</p>
          <div class="actions">
            <a
              v-if="status.paymentSettingsUrl"
              class="btn btn-primary"
              :href="status.paymentSettingsUrl"
              target="_blank"
              rel="noopener noreferrer"
              @click="awaitPayment"
            >
              {{ t("payment.open") }}
              <span class="sr-only">({{ t("payment.newTab") }})</span>
            </a>
            <button
              type="button"
              class="btn btn-outline"
              :disabled="loading"
              @click="recheckPayment"
            >
              <span v-if="loading && paymentRechecked" class="spinner" aria-hidden="true"></span>
              {{ t("payment.recheck") }}
            </button>
          </div>
          <p v-if="paymentRechecked && !loading" class="muted small" aria-live="polite">
            {{ t("payment.stillMissing") }}
          </p>
        </template>
      </section>

      <!-- Tabs -->
      <div class="tabs" role="tablist" :aria-label="t('tabs.label')">
        <button
          v-for="option in TABS"
          :id="`wa-tab-${option}`"
          :key="option"
          type="button"
          role="tab"
          class="tab"
          :class="{ 'tab-selected': tab === option }"
          :aria-selected="tab === option"
          :aria-controls="`wa-panel-${option}`"
          @click="tab = option"
        >
          {{ option === "manual" ? t("tabs.manual") : t("tabs.embedded") }}
          <span v-if="status.mode === option" class="badge badge-neutral">
            {{ t("tabs.active") }}
          </span>
        </button>
      </div>

      <!-- Embedded Signup -->
      <div
        v-if="tab === 'embedded-signup'"
        id="wa-panel-embedded-signup"
        role="tabpanel"
        aria-labelledby="wa-tab-embedded-signup"
        class="panel"
      >
        <p class="body">{{ t("embedded.intro") }}</p>

        <p v-if="!esConfigured" class="notice notice-warning">{{ t("embedded.notConfigured") }}</p>
        <p v-else-if="status.mode !== 'embedded-signup'" class="notice notice-warning">
          {{ t("embedded.notActive") }}
        </p>
        <p v-else-if="status.connected" class="success-line">
          <svg
            class="icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
          {{ t("embedded.connectedHint") }}
        </p>
        <template v-else>
          <p v-if="!isHttps" class="notice notice-warning small">{{ t("embedded.httpsHint") }}</p>
          <div class="actions">
            <button
              v-if="stage === 'ready'"
              type="button"
              class="btn btn-primary"
              @click="openPopup"
            >
              {{ t("embedded.continue") }}
            </button>
            <button v-else type="button" class="btn btn-primary" :disabled="busy" @click="connect">
              <span v-if="busy" class="spinner spinner-light" aria-hidden="true"></span>
              {{ stage === "idle" ? t("embedded.connect") : t("embedded.tryAgain") }}
            </button>
          </div>
        </template>

        <p
          class="stage"
          :class="{
            'stage-error': stage === 'error',
            'stage-success': stage === 'connected',
          }"
          role="status"
          aria-live="polite"
        >
          {{ stageMessage }}
        </p>

        <div class="info-box">
          <strong>{{ t("embedded.explainer.title") }}</strong>
          <ul>
            <li>{{ t("embedded.explainer.ownership") }}</li>
            <li>{{ t("embedded.explainer.coexistence") }}</li>
            <li>{{ t("embedded.explainer.billing") }}</li>
          </ul>
        </div>
      </div>

      <!-- Manual token -->
      <div
        v-else
        id="wa-panel-manual"
        role="tabpanel"
        aria-labelledby="wa-tab-manual"
        class="panel"
      >
        <p class="body">{{ t("manual.intro") }}</p>
        <p v-if="status.mode === 'manual'" class="success-line">{{ t("manual.active") }}</p>
        <p v-else class="notice notice-warning">{{ t("manual.notActive") }}</p>

        <ol class="steps">
          <li v-for="(step, index) in MANUAL_STEPS" :key="step" class="step">
            <div class="step-header">
              <span class="step-number" aria-hidden="true">{{ index + 1 }}</span>
              <h5>{{ t(`manual.steps.${step}.title`) }}</h5>
            </div>
            <!-- Static, plugin-owned i18n markup (strong/code only); no user input. -->
            <p class="body" v-html="t(`manual.steps.${step}.body`)"></p>
            <div v-if="step === 'webhook'" class="url-box">
              <code class="url">{{ webhookUrl }}</code>
              <button
                type="button"
                class="copy-btn"
                :aria-label="t('manual.steps.webhook.copy')"
                :title="t('manual.steps.webhook.copy')"
                @click="copyWebhookUrl"
              >
                <svg
                  v-if="!copied"
                  class="icon"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
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
                  class="icon icon-success"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </button>
              <span class="sr-only" aria-live="polite">
                {{ copied ? t("manual.steps.webhook.copied") : "" }}
              </span>
            </div>
          </li>
        </ol>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from "vue";
import type { ChannelStatus } from "../../src/status";
import { createTranslator } from "./messages";
import { loadFacebookSdk, runEmbeddedSignup, type SignupSession } from "./embedded-signup";

type Tab = "embedded-signup" | "manual";
type Stage =
  | "idle"
  | "loading-sdk"
  | "ready"
  | "popup"
  | "finishing"
  | "connected"
  | "cancelled"
  | "error";
type FacebookSdk = Awaited<ReturnType<typeof loadFacebookSdk>>;

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
    oauth: {
      completeWithCode: {
        mutate(input: {
          pluginId: string;
          code: string;
          extras?: Record<string, string>;
        }): Promise<{ success: boolean; onConnected: { ok: boolean; routingKeyCount: number } }>;
      };
    };
  };
}

const TABS: Tab[] = ["embedded-signup", "manual"];
const MANUAL_STEPS = ["app", "token", "ids", "form", "webhook", "register"];
const NO_API = "no-api";
/** Above this the click's user activation may have expired and the popup could be blocked. */
const POPUP_ACTIVATION_BUDGET_MS = 1000;
const LIMIT_TIERS: Record<string, number> = {
  TIER_250: 250,
  TIER_2K: 2000,
  TIER_10K: 10000,
  TIER_100K: 100000,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isChannelStatus(value: unknown): value is ChannelStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    "connected" in value &&
    "mode" in value &&
    "embeddedSignup" in value
  );
}

function toneOf(value: string | undefined, good: string[], warn: string[], bad: string[]): string {
  if (value && good.includes(value)) return "badge-success";
  if (value && warn.includes(value)) return "badge-warning";
  if (value && bad.includes(value)) return "badge-danger";
  return "badge-neutral";
}

export default defineComponent({
  name: "WhatsAppAfterSettings",
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
  emits: ["update:config"],
  setup(props) {
    const translator = computed(() => createTranslator(props.locale));
    const t = (key: string, params?: Record<string, string | number>) =>
      translator.value(key, params);

    /** Translate an enum value under `group`, falling back to the raw value. */
    const label = (group: string, value: string | undefined): string => {
      if (!value) return t("health.unknown");
      const key = `${group}.${value}`;
      const translated = t(key);
      return translated === key ? value.replace(/_/g, " ").toLowerCase() : translated;
    };

    const pluginId = computed(() => props.plugin?.id || "hay-channel-whatsapp-meta");

    // --- Status -------------------------------------------------------------
    const status = ref<ChannelStatus | null>(null);
    const statusError = ref<string | null>(null);
    const loading = ref(false);
    const tab = ref<Tab>(props.config?.connectionMode === "manual" ? "manual" : "embedded-signup");
    let tabInitialized = false;

    const loadStatus = async (options: { quiet?: boolean } = {}): Promise<void> => {
      if (!props.api) {
        statusError.value = NO_API;
        return;
      }
      loading.value = true;
      if (!options.quiet) statusError.value = null;
      try {
        const response = await props.api.plugins.callUiRoute.mutate({
          pluginId: pluginId.value,
          method: "GET",
          path: "/ui/status",
        });
        if (response.status !== 200 || !isChannelStatus(response.data)) {
          throw new Error(`Worker responded with HTTP ${response.status}`);
        }
        status.value = response.data;
        statusError.value = null;
        if (!tabInitialized) {
          tab.value = response.data.mode === "manual" ? "manual" : "embedded-signup";
          tabInitialized = true;
        }
      } catch (error: unknown) {
        statusError.value = errorMessage(error);
      } finally {
        loading.value = false;
      }
    };

    const phone = computed(() => status.value?.phone);
    const canSend = computed(() => phone.value?.health_status?.can_send_message);
    const canSendTone = computed(() =>
      toneOf(canSend.value, ["AVAILABLE"], ["LIMITED"], ["BLOCKED"]),
    );
    const qualityTone = computed(() =>
      toneOf(phone.value?.quality_rating, ["GREEN"], ["YELLOW"], ["RED"]),
    );
    const nameStatusTone = computed(() =>
      toneOf(
        phone.value?.name_status,
        ["APPROVED", "AVAILABLE_WITHOUT_REVIEW"],
        ["PENDING_REVIEW", "NONE"],
        ["DECLINED", "EXPIRED"],
      ),
    );
    const healthErrors = computed(() =>
      (phone.value?.health_status?.entities ?? []).flatMap((entity) =>
        (entity.errors ?? [])
          .filter((error) => error.error_description)
          .map((error) => ({
            description: error.error_description as string,
            solution: error.possible_solution,
          })),
      ),
    );
    const messagingLimit = computed(() => {
      const tier = phone.value?.whatsapp_business_manager_messaging_limit;
      if (!tier) return "";
      if (tier === "TIER_UNLIMITED") return t("health.limits.unlimited");
      const count = LIMIT_TIERS[tier];
      if (count === undefined) return tier;
      return t("health.limits.tier", { count: new Intl.NumberFormat(props.locale).format(count) });
    });

    // --- Payment method re-check ---------------------------------------------
    const awaitingPayment = ref(false);
    const paymentRechecked = ref(false);

    const recheckPayment = async () => {
      await loadStatus({ quiet: true });
      paymentRechecked.value = true;
      if (status.value?.waba?.hasPaymentMethod) {
        awaitingPayment.value = false;
      }
    };
    const awaitPayment = () => {
      awaitingPayment.value = true;
      paymentRechecked.value = false;
    };
    const onReturn = () => {
      if (!awaitingPayment.value || loading.value || document.visibilityState !== "visible") return;
      void recheckPayment();
    };

    // --- Embedded Signup -----------------------------------------------------
    const stage = ref<Stage>("idle");
    const stageDetail = ref("");
    let readySdk: FacebookSdk | null = null;

    const esConfigured = computed(
      () => !!status.value?.embeddedSignup.appId && !!status.value?.embeddedSignup.configId,
    );
    const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
    const busy = computed(() => ["loading-sdk", "popup", "finishing"].includes(stage.value));

    const stageMessage = computed(() => {
      switch (stage.value) {
        case "loading-sdk":
          return t("embedded.stage.loadingSdk");
        case "ready":
          return t("embedded.stage.ready");
        case "popup":
          return t("embedded.stage.popup");
        case "finishing":
          return t("embedded.stage.finishing");
        case "connected":
          return t("embedded.stage.connected");
        case "cancelled":
          return stageDetail.value
            ? t("embedded.stage.cancelledAt", { step: stageDetail.value })
            : t("embedded.stage.cancelled");
        case "error":
          return stageDetail.value;
        default:
          return "";
      }
    });

    const fail = (message: string) => {
      stage.value = "error";
      stageDetail.value = message;
    };

    const signupExtras = (session: SignupSession | null): Record<string, string> => {
      const extras: Record<string, string> = {};
      if (!session) return extras;
      extras.event = session.event;
      if (session.wabaId) extras.waba_id = session.wabaId;
      if (session.phoneNumberId) extras.phone_number_id = session.phoneNumberId;
      if (session.businessId) extras.business_id = session.businessId;
      return extras;
    };

    const finishSignup = async (code: string, session: SignupSession | null) => {
      if (!props.api) {
        fail(t("statusError.noApi"));
        return;
      }
      stage.value = "finishing";
      try {
        const result = await props.api.plugins.oauth.completeWithCode.mutate({
          pluginId: pluginId.value,
          code,
          extras: signupExtras(session),
        });
        if (result.onConnected.routingKeyCount === 0) {
          fail(t("embedded.stage.unverified"));
          return;
        }
        stage.value = "connected";
        // Let the dashboard's OAuth card refresh its connection status.
        window.dispatchEvent(
          new CustomEvent("hay:plugin-connection-changed", {
            detail: { pluginId: pluginId.value },
          }),
        );
        await loadStatus({ quiet: true });
      } catch (error: unknown) {
        fail(t("embedded.stage.error", { message: errorMessage(error) }));
      }
    };

    /** Must run synchronously from a click so the popup is not blocked. */
    const openPopup = () => {
      const fb = readySdk;
      const configId = status.value?.embeddedSignup.configId;
      if (!fb || !configId) return;
      readySdk = null;
      stage.value = "popup";
      stageDetail.value = "";
      runEmbeddedSignup(fb, configId)
        .then(async ({ code, session }) => {
          if (code) {
            await finishSignup(code, session);
          } else if (session?.event === "ERROR") {
            fail(t("embedded.stage.error", { message: session.errorMessage || "ERROR" }));
          } else {
            stage.value = "cancelled";
            stageDetail.value = session?.currentStep ?? "";
          }
        })
        .catch((error: unknown) =>
          fail(t("embedded.stage.error", { message: errorMessage(error) })),
        );
    };

    const connect = async () => {
      const appId = status.value?.embeddedSignup.appId;
      if (!appId || busy.value) return;
      stage.value = "loading-sdk";
      stageDetail.value = "";
      const startedAt = Date.now();
      try {
        readySdk = await loadFacebookSdk(appId);
      } catch {
        fail(t("embedded.stage.sdkFailed"));
        return;
      }
      if (Date.now() - startedAt > POPUP_ACTIVATION_BUDGET_MS) {
        // A slow first load can outlive the click's user activation; ask for a second click.
        stage.value = "ready";
        return;
      }
      openPopup();
    };

    // --- Manual mode webhook URL --------------------------------------------
    const webhookUrl = computed(() => {
      const base = (props.apiBaseUrl || "http://localhost:3001").replace(/\/$/, "");
      const orgId = String(props.config?.organizationId ?? "YOUR_ORG_ID");
      return `${base}/v1/plugins/${encodeURIComponent(pluginId.value)}/webhook?organizationId=${encodeURIComponent(orgId)}`;
    });
    const copied = ref(false);
    let copiedTimer: ReturnType<typeof setTimeout> | undefined;
    const copyWebhookUrl = async () => {
      try {
        await navigator.clipboard.writeText(webhookUrl.value);
      } catch {
        const textArea = document.createElement("textarea");
        textArea.value = webhookUrl.value;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      copied.value = true;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copied.value = false;
      }, 2000);
    };

    onMounted(() => {
      void loadStatus();
      window.addEventListener("focus", onReturn);
      document.addEventListener("visibilitychange", onReturn);
    });
    onBeforeUnmount(() => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
      clearTimeout(copiedTimer);
    });

    return {
      TABS,
      MANUAL_STEPS,
      NO_API,
      t,
      label,
      status,
      statusError,
      loading,
      loadStatus,
      tab,
      phone,
      canSend,
      canSendTone,
      qualityTone,
      nameStatusTone,
      healthErrors,
      messagingLimit,
      paymentRechecked,
      awaitPayment,
      recheckPayment,
      stage,
      stageMessage,
      esConfigured,
      isHttps,
      busy,
      connect,
      openPopup,
      webhookUrl,
      copied,
      copyWebhookUrl,
    };
  },
});
</script>

<style scoped>
.whatsapp-setup {
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
