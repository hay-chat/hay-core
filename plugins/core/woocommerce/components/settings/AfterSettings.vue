<template>
  <section class="woo-connect" aria-labelledby="woo-connect-title">
    <div class="setup-header">
      <h3 id="woo-connect-title">{{ t("connect.title") }}</h3>
      <p>{{ t("connect.intro") }}</p>
    </div>

    <div v-if="stage === 'connected'" class="notice notice-success" role="status">
      <div>
        <strong>{{ t("connect.connectedTitle") }}</strong>
        <p>{{ t("connect.connectedBody") }}</p>
      </div>
    </div>
    <p v-else-if="hasKeys" class="muted">{{ t("connect.alreadyConnected") }}</p>

    <div v-if="errorCode" class="notice notice-error" role="alert">
      <div>
        <strong>{{ t("connect.errorTitle") }}</strong>
        <p>{{ errorText }}</p>
      </div>
    </div>

    <p v-if="!siteUrl" class="muted">{{ t("connect.needSiteUrl") }}</p>

    <p v-if="stage === 'waiting'" class="muted" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      {{ t("connect.waiting") }}
    </p>
    <p v-if="stage === 'saving'" class="muted" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      {{ t("connect.saving") }}
    </p>

    <div class="actions">
      <button
        type="button"
        class="btn btn-primary"
        :disabled="!siteUrl || stage === 'starting' || stage === 'saving'"
        @click="connect"
      >
        <span v-if="stage === 'starting'" class="spinner spinner-light" aria-hidden="true"></span>
        {{ hasKeys || stage === "connected" ? t("connect.reconnect") : t("connect.button") }}
      </button>
      <button v-if="stage === 'waiting'" type="button" class="btn btn-outline" @click="cancel">
        {{ t("connect.cancel") }}
      </button>
    </div>
    <p class="muted small">{{ t("connect.manualHint") }}</p>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, ref, type PropType } from "vue";
import { createTranslator } from "./messages";

type Stage = "idle" | "starting" | "waiting" | "saving" | "connected";

interface UiRouteResponse {
  status: number;
  data: unknown;
}

/** The slice of the dashboard tRPC client (`Hay`) this component uses. */
interface HayApi {
  plugins: {
    callUiRoute: {
      mutate(input: {
        pluginId: string;
        method: "GET" | "POST";
        path: string;
        body?: Record<string, unknown>;
      }): Promise<UiRouteResponse>;
    };
    configure: {
      mutate(input: { pluginId: string; configuration: Record<string, unknown> }): Promise<unknown>;
    };
  };
}

const POLL_MS = 2000;
/** Matches the worker's session TTL. */
const MAX_WAIT_MS = 15 * 60 * 1000;
const KNOWN_ERRORS = [
  "SITE_URL_MISSING",
  "SITE_URL_INVALID",
  "HTTPS_REQUIRED",
  "WRONG_PERMISSIONS",
  "KEYS_REJECTED",
  "STORE_UNREACHABLE",
  "BAD_KEYS",
  "EXPIRED",
  "POPUP_BLOCKED",
  "SAVE_FAILED",
];

function errorCodeOf(data: unknown): string {
  const code = (data as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "string" ? code : "UNKNOWN";
}

export default defineComponent({
  name: "WooCommerceAfterSettings",
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
  setup(props, { emit }) {
    const translator = computed(() => createTranslator(props.locale));
    const t = (key: string, params?: Record<string, string | number>) =>
      translator.value(key, params);

    const pluginId = computed(() => props.plugin?.id || "hay-plugin-woocommerce");
    const siteUrl = computed(() =>
      typeof props.config?.siteUrl === "string" ? props.config.siteUrl.trim() : "",
    );
    const hasKeys = computed(() => Boolean(props.config?.consumerKey));

    const stage = ref<Stage>("idle");
    const errorCode = ref<string | null>(null);
    const errorDetail = ref<string>("");
    const errorText = computed(() => {
      if (!errorCode.value) return "";
      if (KNOWN_ERRORS.includes(errorCode.value)) return t(`connect.errors.${errorCode.value}`);
      return t("connect.errors.UNKNOWN", { detail: errorDetail.value || errorCode.value });
    });

    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let startedAt = 0;

    const fail = (code: string, detail = "") => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = undefined;
      stage.value = "idle";
      errorCode.value = code;
      errorDetail.value = detail;
    };

    const save = async (keys: { consumerKey: string; consumerSecret: string }) => {
      if (!props.api) return fail("UNKNOWN", "no api");
      stage.value = "saving";
      try {
        await props.api.plugins.configure.mutate({
          pluginId: pluginId.value,
          configuration: { consumerKey: keys.consumerKey, consumerSecret: keys.consumerSecret },
        });
        // Keep the settings form in step with what was saved.
        emit("update:config", {
          consumerKey: keys.consumerKey,
          consumerSecret: keys.consumerSecret,
        });
        stage.value = "connected";
      } catch (error: unknown) {
        fail("SAVE_FAILED", error instanceof Error ? error.message : String(error));
      }
    };

    const poll = async (nonce: string) => {
      if (!props.api) return;
      if (Date.now() - startedAt > MAX_WAIT_MS) return fail("EXPIRED");
      try {
        const response = await props.api.plugins.callUiRoute.mutate({
          pluginId: pluginId.value,
          method: "POST",
          path: "/ui/wc-auth/status",
          body: { nonce },
        });
        const data = (response.data ?? {}) as Record<string, unknown>;
        if (data.state === "connected") {
          await save({
            consumerKey: String(data.consumerKey),
            consumerSecret: String(data.consumerSecret),
          });
          return;
        }
        if (data.state === "error") return fail(String(data.code), String(data.message ?? ""));
        if (data.state === "unknown") return fail("EXPIRED");
      } catch {
        // Transient (worker restarting, network); keep polling until the deadline.
      }
      if (stage.value === "waiting") pollTimer = setTimeout(() => poll(nonce), POLL_MS);
    };

    const connect = async () => {
      if (!props.api) return fail("UNKNOWN", "no api");
      errorCode.value = null;
      stage.value = "starting";
      // Open the window inside the click so popup blockers allow it.
      const popup = window.open("", "_blank");
      try {
        const response = await props.api.plugins.callUiRoute.mutate({
          pluginId: pluginId.value,
          method: "POST",
          path: "/ui/wc-auth/start",
          body: { returnUrl: window.location.href },
        });
        const data = response.data as { authorizeUrl?: string; nonce?: string } | null;
        if (response.status !== 200 || !data?.authorizeUrl || !data.nonce) {
          popup?.close();
          return fail(errorCodeOf(response.data));
        }
        if (popup) {
          popup.location.href = data.authorizeUrl;
        } else {
          return fail("POPUP_BLOCKED");
        }
        startedAt = Date.now();
        stage.value = "waiting";
        pollTimer = setTimeout(() => poll(data.nonce as string), POLL_MS);
      } catch (error: unknown) {
        popup?.close();
        fail("UNKNOWN", error instanceof Error ? error.message : String(error));
      }
    };

    const cancel = () => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = undefined;
      stage.value = "idle";
    };

    onBeforeUnmount(() => {
      if (pollTimer) clearTimeout(pollTimer);
    });

    return { t, siteUrl, hasKeys, stage, errorCode, errorText, connect, cancel };
  },
});
</script>

<style scoped>
.woo-connect {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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

.small {
  font-size: 0.8125rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.notice {
  border-radius: 6px;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  line-height: 1.5;
}

.notice p {
  margin: 0.25rem 0 0 0;
}

.notice-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

.notice-success {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
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
  border: 1px solid transparent;
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-outline {
  background: transparent;
  border-color: #d1d5db;
  color: #374151;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid #d1d5db;
  border-top-color: #6b7280;
  border-radius: 50%;
  animation: woo-spin 0.8s linear infinite;
  vertical-align: middle;
}

.spinner-light {
  border-color: rgba(255, 255, 255, 0.4);
  border-top-color: white;
}

@keyframes woo-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
