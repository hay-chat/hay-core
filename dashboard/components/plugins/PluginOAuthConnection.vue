<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div class="space-y-1">
        <h3 class="text-lg font-medium">
          {{ t("pluginSettings.oauth.title", { name: pluginName }) }}
        </h3>
        <p class="text-sm text-muted-foreground">
          {{ description || t("pluginSettings.oauth.description", { name: pluginName }) }}
        </p>
      </div>
    </div>

    <!-- OAuth Connection Status -->
    <div
      v-if="oauthStatus"
      class="p-4 rounded-lg border"
      :class="
        !oauthStatus.connected
          ? 'bg-neutral-50 border-border dark:bg-neutral-900/20'
          : oauthStatus.expired
            ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800'
            : 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800'
      "
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex items-center space-x-3">
          <div
            v-if="oauthStatus.connected && oauthStatus.expired"
            class="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center"
          >
            <AlertTriangle class="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <img
            v-else-if="oauthStatus.connected && oauthStatus.account?.avatarUrl && !avatarFailed"
            :src="oauthStatus.account.avatarUrl"
            :alt="oauthStatus.account.label"
            class="w-10 h-10 rounded-full object-cover"
            referrerpolicy="no-referrer"
            @error="avatarFailed = true"
          />
          <div
            v-else-if="oauthStatus.connected"
            class="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center"
          >
            <CheckCircle class="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div
            v-else
            class="w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center"
          >
            <Link2 class="h-5 w-5 text-neutral-400" />
          </div>

          <div class="space-y-1">
            <p class="font-medium">
              {{
                !oauthStatus.connected
                  ? t("pluginSettings.oauth.notConnected")
                  : oauthStatus.expired
                    ? t("pluginSettings.oauth.expired")
                    : oauthStatus.account
                      ? t("pluginSettings.oauth.connectedAs", {
                          account: oauthStatus.account.label,
                        })
                      : t("pluginSettings.oauth.connected")
              }}
            </p>
            <p
              v-if="oauthStatus.connected && oauthStatus.connectedAt"
              class="text-xs text-muted-foreground"
            >
              {{ t("pluginSettings.oauth.connectedAt", { date: formatDate(oauthStatus.connectedAt) }) }}
            </p>
            <p
              v-if="oauthStatus.connected && oauthStatus.expired"
              class="text-xs text-amber-700 dark:text-amber-400"
            >
              {{
                oauthStatus.expiresAt
                  ? t("pluginSettings.oauth.expiredAt", { date: formatDate(oauthStatus.expiresAt) })
                  : t("pluginSettings.oauth.expiredHint")
              }}
            </p>
            <p
              v-else-if="oauthStatus.connected && oauthStatus.expiresAt"
              class="text-xs text-muted-foreground"
            >
              {{ t("pluginSettings.oauth.expiresAt", { date: formatDate(oauthStatus.expiresAt) }) }}
            </p>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex flex-wrap items-center gap-2">
          <Button
            v-if="!oauthStatus.connected && !isClientFlow"
            @click="handleConnect"
            :disabled="connecting"
            :loading="connecting"
            size="sm"
          >
            {{ t("pluginSettings.oauth.connect", { name: pluginName }) }}
          </Button>
          <Button
            v-if="oauthStatus.connected && oauthStatus.expired && !isClientFlow"
            @click="handleConnect"
            :disabled="connecting"
            :loading="connecting"
            size="sm"
          >
            {{ t("pluginSettings.oauth.reconnect") }}
          </Button>
          <Button
            v-if="oauthStatus.connected"
            @click="handleDisconnect"
            variant="outline"
            size="sm"
            :disabled="disconnecting"
            :loading="disconnecting"
          >
            {{ t("pluginSettings.oauth.disconnect") }}
          </Button>
        </div>
      </div>

      <!-- Error Message -->
      <div
        v-if="oauthStatus.error"
        class="mt-3 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-200"
      >
        {{ oauthStatus.error }}
      </div>
    </div>

    <!-- Info/Alternative Text -->
    <div v-if="infoText" class="pt-2 border-t">
      <div class="flex items-center space-x-2 text-sm text-muted-foreground">
        <Info class="h-4 w-4" />
        <span>{{ infoText }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from "vue";
import { useI18n } from "vue-i18n";
import { CheckCircle, Link2, Info, AlertTriangle } from "lucide-vue-next";
import type { PluginDisplay, PluginConfig } from "@/types/plugin.types";

interface OAuthStatus {
  connected: boolean;
  expired?: boolean;
  expiresAt?: number;
  connectedAt?: number;
  account?: { label: string; avatarUrl?: string };
  error?: string;
}

interface Props {
  plugin: PluginDisplay;
  config?: PluginConfig;
  apiBaseUrl?: string;
  description?: string;
  infoText?: string;
  oauthAvailable?: boolean; // Passed from parent
  oauthConfigured?: boolean; // Passed from parent
}

const props = defineProps<Props>();

const { t } = useI18n();

const oauthStatus = ref<OAuthStatus | null>(null);
const connecting = ref(false);
// Provider avatar URLs are often signed/expiring; fall back to the status icon.
const avatarFailed = ref(false);
const disconnecting = ref(false);

// Compute plugin name from plugin data
const pluginName = computed(() => props.plugin?.name || props.plugin?.id || "Service");

// "client" flow plugins obtain the code in their own settings UI, so the
// platform's redirect Connect/Reconnect buttons are hidden.
const isClientFlow = computed(() => {
  const oauth2 = props.plugin?.metadata?.authMethods?.find((method) => method.type === "oauth2");
  return oauth2?.connectFlow === "client";
});

// Use OAuth availability from props (already checked by parent)
const oauthAvailable = computed(() => props.oauthAvailable && props.oauthConfigured);
const oauthCheckComplete = ref(true); // Always true since props are passed

// Fetch OAuth status
const fetchOAuthStatus = async () => {
  try {
    const { Hay } = await import("@/utils/api");
    const status = await Hay.plugins.oauth.status.query({ pluginId: props.plugin.id });
    oauthStatus.value = status;
  } catch (error) {
    console.error("Failed to fetch OAuth status:", error);
    oauthStatus.value = { connected: false, error: t("pluginSettings.oauth.statusFailed") };
  }
};

// Handle OAuth connection
const handleConnect = async () => {
  connecting.value = true;

  try {
    const { Hay } = await import("@/utils/api");
    const { useToast } = await import("@/composables/useToast");
    const toast = useToast();

    const result = await Hay.plugins.oauth.initiate.mutate({ pluginId: props.plugin.id });
    const { authorizationUrl } = result;

    // Redirect to OAuth provider page
    window.location.href = authorizationUrl;
  } catch (error) {
    console.error("Failed to initiate OAuth:", error);
    const { useToast } = await import("@/composables/useToast");
    const toast = useToast();
    const errorMessage =
      error instanceof Error
        ? error.message
        : t("pluginSettings.toast.oauthConnectFailed", { name: pluginName.value });
    toast.error(errorMessage);
    connecting.value = false;
  }
};

// Handle OAuth disconnection
const handleDisconnect = async () => {
  disconnecting.value = true;

  try {
    const { Hay } = await import("@/utils/api");
    const { useToast } = await import("@/composables/useToast");
    const toast = useToast();

    await Hay.plugins.oauth.revoke.mutate({ pluginId: props.plugin.id });

    toast.success(t("pluginSettings.toast.oauthDisconnectedFrom", { name: pluginName.value }));
    await fetchOAuthStatus();
  } catch (error) {
    console.error("Failed to revoke OAuth:", error);
    const { useToast } = await import("@/composables/useToast");
    const toast = useToast();
    toast.error(t("pluginSettings.toast.oauthDisconnectFailed"));
  } finally {
    disconnecting.value = false;
  }
};

const { formatDate: orgFormatDate } = useOrgDateTime();

// Format date helper
const formatDate = (timestamp: number) => {
  const date = new Date(timestamp * 1000);
  return orgFormatDate(date);
};

// Plugins that connect from their own settings UI (oauth2 connectFlow "client")
// dispatch this window event once the connection changed.
const onPluginConnectionChanged = (event: Event) => {
  const detail = (event as CustomEvent<{ pluginId?: string }>).detail;
  if (detail?.pluginId === props.plugin.id) {
    void fetchOAuthStatus();
  }
};

onBeforeUnmount(() => {
  window.removeEventListener("hay:plugin-connection-changed", onPluginConnectionChanged);
});

// Load status on mount
onMounted(async () => {
  window.addEventListener("hay:plugin-connection-changed", onPluginConnectionChanged);
  // Only fetch status if OAuth is available
  if (oauthAvailable.value) {
    await fetchOAuthStatus();

    // Check for OAuth callback success/error in URL
    const urlParams = new URLSearchParams(window.location.search);
    const oauthParam = urlParams.get("oauth");
    const pluginIdParam = urlParams.get("pluginId");

    if (oauthParam === "success" && pluginIdParam === props.plugin.id) {
      const { useToast } = await import("@/composables/useToast");
      const toast = useToast();
      toast.success(t("pluginSettings.toast.oauthConnectedTo", { name: pluginName.value }));

      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);

      // Refresh status
      setTimeout(fetchOAuthStatus, 1000);
    }
  }
});
</script>
