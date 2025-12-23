<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div class="space-y-1">
        <h3 class="text-lg font-medium">Connect with OAuth</h3>
        <p class="text-sm text-muted-foreground">
          {{ description || `Securely connect your ${pluginName} account using OAuth` }}
        </p>
      </div>
    </div>

    <!-- OAuth Connection Status -->
    <div
      v-if="oauthStatus"
      class="p-4 rounded-lg border"
      :class="
        oauthStatus.connected
          ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800'
          : 'bg-neutral-50 border-border dark:bg-neutral-900/20'
      "
    >
      <div class="flex items-start justify-between">
        <div class="flex items-center space-x-3">
          <div
            v-if="oauthStatus.connected"
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
              {{ oauthStatus.connected ? "Connected via OAuth" : "Not connected" }}
            </p>
            <p
              v-if="oauthStatus.connected && oauthStatus.connectedAt"
              class="text-xs text-muted-foreground"
            >
              Connected {{ formatDate(oauthStatus.connectedAt) }}
            </p>
            <p
              v-if="oauthStatus.connected && oauthStatus.expiresAt"
              class="text-xs text-muted-foreground"
            >
              Token expires {{ formatDate(oauthStatus.expiresAt) }}
            </p>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex items-center space-x-2">
          <Button
            v-if="!oauthStatus.connected"
            @click="handleConnect"
            :disabled="connecting"
            :loading="connecting"
            size="sm"
          >
            Connect to {{ pluginName }}
          </Button>
          <Button
            v-if="oauthStatus.connected"
            @click="handleDisconnect"
            variant="outline"
            size="sm"
            :disabled="disconnecting"
            :loading="disconnecting"
          >
            Disconnect
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
import { ref, onMounted, computed } from "vue";
import { CheckCircle, Link2, Info } from "lucide-vue-next";

interface OAuthStatus {
  connected: boolean;
  expiresAt?: number;
  connectedAt?: number;
  error?: string;
}

interface Props {
  plugin: any;
  config?: any;
  apiBaseUrl?: string;
  description?: string;
  infoText?: string;
  oauthAvailable?: boolean; // Passed from parent
  oauthConfigured?: boolean; // Passed from parent
}

const props = defineProps<Props>();

const oauthStatus = ref<OAuthStatus | null>(null);
const connecting = ref(false);
const disconnecting = ref(false);

// Compute plugin name from plugin data
const pluginName = computed(() => props.plugin?.name || props.plugin?.id || "Service");

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
    oauthStatus.value = { connected: false, error: "Failed to check connection status" };
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
  } catch (error: any) {
    console.error("Failed to initiate OAuth:", error);
    const { useToast } = await import("@/composables/useToast");
    const toast = useToast();
    toast.error(error.message || `Failed to connect to ${pluginName.value}`);
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

    toast.success(`Disconnected from ${pluginName.value}`);
    await fetchOAuthStatus();
  } catch (error) {
    console.error("Failed to revoke OAuth:", error);
    const { useToast } = await import("@/composables/useToast");
    const toast = useToast();
    toast.error("Failed to disconnect");
  } finally {
    disconnecting.value = false;
  }
};

// Format date helper
const formatDate = (timestamp: number) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

// Load status on mount
onMounted(async () => {
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
      toast.success(`Successfully connected to ${pluginName.value}!`);

      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);

      // Refresh status
      setTimeout(fetchOAuthStatus, 1000);
    }
  }
});
</script>
