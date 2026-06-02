<template>
  <Page :title="$t('marketplace.title')" :description="$t('marketplace.description')">
    <!-- Header -->
    <template #header>
      <div class="flex space-x-2">
        <Button v-if="userStore.isAdmin" size="sm" @click="navigateToUpload">
          <Upload class="h-4 w-4 mr-2" />
          {{ $t("marketplace.uploadPlugin") }}
        </Button>
        <Button
          v-if="userStore.isAdmin && customPluginsCount > 0"
          variant="outline"
          size="sm"
          @click="navigateToManage"
        >
          <Settings class="h-4 w-4 mr-2" />
          {{ $t("marketplace.manageCustom", { count: customPluginsCount }) }}
        </Button>
        <Button variant="outline" size="sm" @click="refreshPlugins">
          <RefreshCcw class="h-4 w-4 mr-2" />
          {{ $t("marketplace.refresh") }}
        </Button>
      </div>
    </template>

    <!-- Stats Cards -->
    <div class="grid gap-4 md:grid-cols-4">
      <MetricCard
        :title="$t('marketplace.stats.totalPlugins')"
        :metric="stats.total"
        :subtitle="$t('marketplace.stats.availablePlugins')"
        :icon="Package"
      />
      <MetricCard
        :title="$t('marketplace.stats.installed')"
        :metric="stats.enabled"
        :subtitle="$t('marketplace.stats.activePlugins')"
        :icon="CheckCircle"
        subtitle-color="green"
      />
      <MetricCard
        :title="$t('marketplace.stats.channels')"
        :metric="stats.chatConnectors"
        :subtitle="$t('marketplace.stats.communicationChannels')"
        :icon="MessageSquare"
      />
      <MetricCard
        :title="$t('marketplace.stats.mcpConnectors')"
        :metric="stats.mcpConnectors"
        :subtitle="$t('marketplace.stats.modelContextProtocol')"
        :icon="Cpu"
      />
    </div>

    <!-- Categories -->
    <!-- <div class="flex items-center space-x-2">
      <span class="text-sm font-medium">{{ $t("marketplace.categories.label") }}</span>
      <div class="flex space-x-2 flex-wrap gap-2">
        <Button
          v-for="category in categories"
          :key="category.id"
          :variant="selectedCategory === category.id ? 'default' : 'outline'"
          size="sm"
          @click="selectedCategory = category.id"
        >
          <component :is="category.icon" class="h-4 w-4 mr-2" />
          {{ category.name }}
        </Button>
      </div>
    </div> -->

    <!-- Search -->
    <!-- <div class="flex items-center space-x-4">
      <div class="relative flex-1 max-w-sm">
        <Search class="absolute left-2 top-2.5 h-4 w-4 text-neutral-muted" />
        <Input v-model="searchQuery" :placeholder="$t('marketplace.search')" class="pl-8" />
      </div>
    </div> -->

    <!-- Loading State -->
    <div v-if="loading" class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <div v-for="i in 6" :key="i" class="animate-pulse">
        <Card>
          <CardHeader>
            <div class="h-4 bg-gray-200 rounded w-1/3" />
            <div class="h-3 bg-gray-200 rounded w-2/3 mt-2" />
          </CardHeader>
          <CardContent>
            <div class="h-3 bg-gray-200 rounded w-full" />
            <div class="h-3 bg-gray-200 rounded w-1/2 mt-2" />
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredPlugins.length === 0" class="text-center py-12">
      <Package class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
      <h3 class="text-lg font-medium mb-2">{{ $t("marketplace.empty.title") }}</h3>
      <p class="text-neutral-muted">
        {{
          searchQuery ? $t("marketplace.empty.searchHint") : $t("marketplace.empty.categoryHint")
        }}
      </p>
    </div>

    <!-- Plugins Grid -->
    <div v-else class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Card
        v-for="plugin in filteredPlugins"
        :key="plugin.id"
        class="hover:shadow-md transition-shadow"
      >
        <CardHeader>
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center space-x-3 min-w-0">
              <div
                class="w-12 h-12 min-w-12 min-h-12 rounded-lg overflow-hidden shadow-md bg-background-tertiary flex items-center justify-center"
              >
                <img
                  :src="getPluginThumbnail(plugin.id)"
                  :alt="`${plugin.name} thumbnail`"
                  class="w-full h-full object-cover"
                  @error="handleThumbnailError($event)"
                />
                <Package class="h-6 w-6 text-neutral-muted hidden" />
              </div>
              <div class="min-w-0">
                <div class="flex items-center space-x-2 min-w-0">
                  <CardTitle class="text-lg truncate">
                    {{ plugin.name }}
                  </CardTitle>
                  <Badge v-if="plugin.isCustom" variant="outline" class="text-xs">
                    {{ $t("marketplace.custom") }}
                  </Badge>
                </div>
              </div>
            </div>
            <div class="flex space-x-2 shrink-0">
              <Button
                v-if="!plugin.enabled"
                size="sm"
                :disabled="enablingPlugin === plugin.id"
                @click="enablePlugin(plugin.id)"
              >
                <Plug class="h-3 w-3 mr-1" />
                {{
                  enablingPlugin === plugin.id
                    ? $t("marketplace.actions.installing")
                    : $t("marketplace.actions.install")
                }}
              </Button>

              <template v-else>
                <Button size="sm" @click="navigateToSettings(plugin.id)">
                  <Settings class="h-3 w-3 mr-1" />
                  {{ $t("marketplace.actions.configure") }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="disablingPlugin === plugin.id"
                  @click="disablePlugin(plugin.id)"
                >
                  <Power class="h-3 w-3 mr-1" />
                  {{
                    disablingPlugin === plugin.id
                      ? $t("marketplace.actions.removing")
                      : $t("marketplace.actions.remove")
                  }}
                </Button>
              </template>

              <!-- Delete button for custom plugins (admin only) -->
              <Button
                v-if="plugin.isCustom && userStore.isAdmin"
                variant="destructive"
                size="sm"
                :disabled="deletingPlugin === plugin.id"
                @click="deletePlugin(plugin.id)"
              >
                <Trash2 class="h-3 w-3 mr-1" />
                {{
                  deletingPlugin === plugin.id
                    ? $t("marketplace.actions.deleting")
                    : $t("marketplace.actions.delete")
                }}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  </Page>
</template>

<script setup lang="ts">
import {
  Package,
  CheckCircle,
  MessageSquare,
  Cpu,
  RefreshCcw,
  Settings,
  Plug,
  Power,
  Upload,
  Trash2,
} from "lucide-vue-next";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { useToast } from "@/composables/useToast";
import { useDomain } from "@/composables/useDomain";

const { t } = useI18n();

// Reactive state
const loading = ref(true);
const searchQuery = ref("");
const selectedCategory = ref("all");
const enablingPlugin = ref<string | null>(null);
const disablingPlugin = ref<string | null>(null);
const deletingPlugin = ref<string | null>(null);

// Use stores
const appStore = useAppStore();
const authStore = useAuthStore();
const userStore = useUserStore();

// Router
const router = useRouter();

// Get available (non-enabled) plugins for marketplace
const availablePlugins = computed(() => appStore.availablePlugins);

// Count of custom plugins
const customPluginsCount = computed(() => {
  return appStore.plugins.filter((p) => p.isCustom).length;
});

// Stats computed from all plugins (including enabled ones for stats display)
const stats = computed(() => {
  const allPlugins = appStore.plugins;
  return {
    total: allPlugins.length,
    enabled: appStore.enabledPlugins.length,
    chatConnectors: allPlugins.filter((p) => p.type.includes("channel")).length,
    mcpConnectors: allPlugins.filter((p) => p.type.includes("mcp-connector")).length,
  };
});

// Computed filtered plugins (only show available/non-enabled plugins)
const filteredPlugins = computed(() => {
  let filtered = availablePlugins.value || [];

  // Filter by category
  if (selectedCategory.value !== "all") {
    filtered = filtered.filter((p) => p.type.includes(selectedCategory.value));
  }

  // Filter by search
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    filtered = filtered.filter(
      (p) =>
        (p.id && p.id.toLowerCase().includes(query)) ||
        (p.name && p.name.toLowerCase().includes(query)) ||
        (p.description && p.description.toLowerCase().includes(query)),
    );
  }

  return filtered;
});

const getPluginThumbnail = (pluginId: string) => {
  const { getApiUrl } = useDomain();
  return getApiUrl(`/plugins/thumbnails/${encodeURIComponent(pluginId)}`);
};

const handleThumbnailError = (event: Event) => {
  // Hide the image and show the fallback icon
  const imgElement = event.target as HTMLImageElement;
  const fallbackElement = imgElement.nextElementSibling as HTMLElement;

  imgElement.style.display = "none";
  if (fallbackElement) {
    fallbackElement.style.display = "flex";
  }
};

const fetchPlugins = async () => {
  loading.value = true;
  try {
    await appStore.fetchPlugins();
    console.log("🔍 [DEBUG] Fetched plugins:", appStore.plugins);
  } catch (error) {
    console.error("Failed to fetch plugins:", error);
  } finally {
    loading.value = false;
  }
};

const refreshPlugins = () => {
  fetchPlugins();
};

const enablePlugin = async (pluginId: string) => {
  console.log("🔍 [DEBUG] Enabling plugin with ID:", pluginId);
  enablingPlugin.value = pluginId;
  const { toast } = useToast();

  try {
    await appStore.enablePlugin(pluginId);

    // Show success toast
    const pluginName = pluginId.replace("hay-plugin-", "");
    toast.success(t("marketplace.toast.enabledSuccess", { name: pluginName }));

    // Navigate to settings if plugin has configuration
    const plugin = appStore.getPluginById(pluginId);
    if (plugin?.hasConfiguration) {
      navigateToSettings(pluginId);
    }
  } catch (error: unknown) {
    console.error("Failed to enable plugin:", error);

    // Show error toast with details
    // TRPCError messages are in error.message for client errors
    const errorMessage =
      (error as any)?.message ||
      (error as any)?.data?.message ||
      t("marketplace.toast.enableFailed");

    // Clean up the plugin name in the error message for better readability
    const cleanMessage = errorMessage.replace(/hay-plugin-/g, "");
    toast.error(cleanMessage, undefined, 10000); // Show error for 10 seconds
  } finally {
    enablingPlugin.value = null;
  }
};

const disablePlugin = async (pluginId: string) => {
  disablingPlugin.value = pluginId;
  const { toast } = useToast();

  try {
    await appStore.disablePlugin(pluginId);

    // Show success toast
    const pluginName = pluginId.replace("hay-plugin-", "");
    toast.success(t("marketplace.toast.disabledSuccess", { name: pluginName }));
  } catch (error: unknown) {
    console.error("Failed to disable plugin:", error);

    // Show error toast with details
    const errorMessage =
      (error as any)?.message ||
      (error as any)?.data?.message ||
      t("marketplace.toast.disableFailed");
    const cleanMessage = errorMessage.replace(/hay-plugin-/g, "");
    toast.error(cleanMessage, undefined, 10000); // Show error for 10 seconds
  } finally {
    disablingPlugin.value = null;
  }
};

const navigateToSettings = (pluginId: string) => {
  router.push(`/integrations/plugins/${encodeURIComponent(pluginId)}`);
};

const navigateToUpload = () => {
  router.push("/integrations/plugins/upload");
};

const navigateToManage = () => {
  router.push("/integrations/plugins/manage");
};

const deletePlugin = async (pluginId: string) => {
  deletingPlugin.value = pluginId;
  const { toast } = useToast();
  const { getApiUrl } = useDomain();

  // Confirm deletion
  if (!confirm(t("marketplace.confirmDelete"))) {
    deletingPlugin.value = null;
    return;
  }

  try {
    const response = await fetch(getApiUrl(`/v1/plugins/${encodeURIComponent(pluginId)}`), {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${authStore.tokens?.accessToken}`,
        "x-organization-id": userStore.activeOrganizationId!,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || t("marketplace.toast.deleteFailed"));
    }

    toast.success(t("marketplace.toast.deletedSuccess"));
    await appStore.fetchPlugins();
  } catch (error: unknown) {
    console.error("Failed to delete plugin:", error);
    const errorMessage = (error as any)?.message || t("marketplace.toast.deleteFailed");
    toast.error(errorMessage);
  } finally {
    deletingPlugin.value = null;
  }
};

// Lifecycle
onMounted(() => {
  fetchPlugins();
});

// Set page meta
definePageMeta({
  layout: "default",
});

// Head management
useHead({
  title: t("marketplace.headTitle"),
  meta: [
    {
      name: "description",
      content: t("marketplace.description"),
    },
  ],
});
</script>
