<template>
  <Page
    title="Manage Custom Plugins"
    description="View and manage your organization's custom plugins"
  >
    <template #header>
      <div class="flex space-x-2">
        <Button size="sm" @click="navigateToUpload">
          <Upload class="h-4 w-4 mr-2" />
          Upload Plugin
        </Button>
        <Button variant="outline" size="sm" @click="refreshPlugins">
          <RefreshCcw class="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
    </template>

    <!-- Stats -->
    <div class="grid gap-4 md:grid-cols-3">
      <MetricCard
        title="Custom Plugins"
        :metric="customPlugins.length"
        subtitle="Uploaded by your organization"
        :icon="Package"
      />
      <MetricCard
        title="Enabled"
        :metric="enabledCustomPlugins.length"
        subtitle="Currently active"
        :icon="CheckCircle"
        subtitle-color="green"
      />
      <MetricCard
        title="Total Size"
        :metric="formatTotalSize(totalSize)"
        subtitle="Storage used"
        :icon="HardDrive"
      />
    </div>

    <!-- Loading State -->
    <Card v-if="loading">
      <CardContent class="py-8">
        <div class="flex items-center justify-center">
          <RefreshCcw class="h-6 w-6 animate-spin text-neutral-muted" />
          <span class="ml-2 text-neutral-muted">Loading plugins...</span>
        </div>
      </CardContent>
    </Card>

    <!-- Empty State -->
    <Card v-else-if="customPlugins.length === 0">
      <CardContent class="py-12 text-center">
        <Package class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
        <h3 class="text-lg font-medium mb-2">No custom plugins</h3>
        <p class="text-neutral-muted mb-4">
          Upload your first custom plugin to get started
        </p>
        <Button @click="navigateToUpload">
          <Upload class="h-4 w-4 mr-2" />
          Upload Plugin
        </Button>
      </CardContent>
    </Card>

    <!-- Plugins Table -->
    <Card v-else>
      <CardHeader>
        <CardTitle>Custom Plugins</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <div
            v-for="plugin in customPlugins"
            :key="plugin.id"
            class="flex items-center justify-between p-4 border rounded-lg hover:bg-neutral-muted/50 transition-colors"
          >
            <div class="flex items-center space-x-4">
              <!-- Thumbnail -->
              <div class="w-12 h-12 rounded-lg overflow-hidden bg-neutral-muted flex items-center justify-center">
                <img
                  :src="getPluginThumbnail(plugin.id)"
                  :alt="`${plugin.name} thumbnail`"
                  class="w-full h-full object-cover"
                  @error="handleThumbnailError($event)"
                />
                <Package class="h-6 w-6 text-neutral-muted hidden" />
              </div>

              <!-- Info -->
              <div>
                <div class="flex items-center space-x-2">
                  <h4 class="font-medium">{{ plugin.name }}</h4>
                  <Badge v-if="plugin.enabled" variant="default" class="text-xs">
                    Enabled
                  </Badge>
                  <Badge v-else variant="secondary" class="text-xs">
                    Disabled
                  </Badge>
                </div>
                <div class="flex items-center space-x-4 text-sm text-neutral-muted mt-1">
                  <span>Version: {{ plugin.version }}</span>
                  <span>ID: {{ plugin.id }}</span>
                  <span v-if="plugin.uploadedAt">
                    Uploaded: {{ formatDate(plugin.uploadedAt) }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center space-x-2">
              <Button
                v-if="!plugin.enabled"
                size="sm"
                variant="outline"
                :disabled="enablingPlugin === plugin.id"
                @click="enablePlugin(plugin.id)"
              >
                <Plug class="h-3 w-3 mr-1" />
                {{ enablingPlugin === plugin.id ? "Enabling..." : "Enable" }}
              </Button>
              <Button
                v-else
                size="sm"
                variant="outline"
                :disabled="disablingPlugin === plugin.id"
                @click="disablePlugin(plugin.id)"
              >
                <Power class="h-3 w-3 mr-1" />
                {{ disablingPlugin === plugin.id ? "Disabling..." : "Disable" }}
              </Button>

              <Button
                size="sm"
                variant="outline"
                @click="navigateToSettings(plugin.id)"
              >
                <Settings class="h-3 w-3 mr-1" />
                Settings
              </Button>

              <Button
                size="sm"
                variant="outline"
                @click="updatePlugin(plugin.id)"
              >
                <Upload class="h-3 w-3 mr-1" />
                Update
              </Button>

              <Button
                size="sm"
                variant="destructive"
                :disabled="deletingPlugin === plugin.id"
                @click="deletePlugin(plugin.id)"
              >
                <Trash2 class="h-3 w-3 mr-1" />
                {{ deletingPlugin === plugin.id ? "Deleting..." : "Delete" }}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import {
  Package,
  CheckCircle,
  RefreshCcw,
  Settings,
  Plug,
  Power,
  Upload,
  Trash2,
  HardDrive,
} from "lucide-vue-next";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { useToast } from "@/composables/useToast";
import { useDomain } from "@/composables/useDomain";

const router = useRouter();
const appStore = useAppStore();
const authStore = useAuthStore();
const userStore = useUserStore();
const { toast } = useToast();
const { getApiUrl } = useDomain();

const loading = ref(true);
const enablingPlugin = ref<string | null>(null);
const disablingPlugin = ref<string | null>(null);
const deletingPlugin = ref<string | null>(null);

// Computed
const customPlugins = computed(() => {
  return appStore.plugins.filter((p) => p.isCustom);
});

const enabledCustomPlugins = computed(() => {
  return customPlugins.value.filter((p) => p.enabled);
});

const totalSize = computed(() => {
  // This would need to be added to the API response
  // For now, return 0
  return 0;
});

// Methods
const getPluginThumbnail = (pluginId: string) => {
  return getApiUrl(`/plugins/thumbnails/${encodeURIComponent(pluginId)}`);
};

const handleThumbnailError = (event: Event) => {
  const imgElement = event.target as HTMLImageElement;
  const fallbackElement = imgElement.nextElementSibling as HTMLElement;
  imgElement.style.display = "none";
  if (fallbackElement) {
    fallbackElement.style.display = "flex";
  }
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatTotalSize = (bytes: number): string => {
  if (bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
};

const refreshPlugins = async () => {
  loading.value = true;
  try {
    await appStore.fetchPlugins();
  } finally {
    loading.value = false;
  }
};

const enablePlugin = async (pluginId: string) => {
  enablingPlugin.value = pluginId;
  try {
    await appStore.enablePlugin(pluginId);
    toast.success("Plugin enabled successfully");
  } catch (error: any) {
    console.error("Failed to enable plugin:", error);
    toast.error(error.message || "Failed to enable plugin");
  } finally {
    enablingPlugin.value = null;
  }
};

const disablePlugin = async (pluginId: string) => {
  disablingPlugin.value = pluginId;
  try {
    await appStore.disablePlugin(pluginId);
    toast.success("Plugin disabled successfully");
  } catch (error: any) {
    console.error("Failed to disable plugin:", error);
    toast.error(error.message || "Failed to disable plugin");
  } finally {
    disablingPlugin.value = null;
  }
};

const deletePlugin = async (pluginId: string) => {
  if (!confirm("Are you sure you want to delete this plugin? This action cannot be undone.")) {
    return;
  }

  deletingPlugin.value = pluginId;
  try {
    const response = await fetch(getApiUrl(`/v1/plugins/${pluginId}`), {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${authStore.tokens?.accessToken}`,
        "x-organization-id": userStore.activeOrganizationId!,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to delete plugin");
    }

    toast.success("Plugin deleted successfully");
    await appStore.fetchPlugins();
  } catch (error: any) {
    console.error("Failed to delete plugin:", error);
    toast.error(error.message || "Failed to delete plugin");
  } finally {
    deletingPlugin.value = null;
  }
};

const updatePlugin = (pluginId: string) => {
  // TODO: Implement update flow
  toast.info("Update functionality coming soon");
};

const navigateToSettings = (pluginId: string) => {
  router.push(`/integrations/plugins/${encodeURIComponent(pluginId)}`);
};

const navigateToUpload = () => {
  router.push("/integrations/plugins/upload");
};

// Lifecycle
onMounted(async () => {
  loading.value = true;
  try {
    await appStore.fetchPlugins();
  } finally {
    loading.value = false;
  }
});

definePageMeta({
  layout: "default",
  middleware: ["auth"],
});

useHead({
  title: "Manage Custom Plugins - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "View and manage your organization's custom plugins",
    },
  ],
});
</script>
