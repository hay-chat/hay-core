<template>
  <Page :title="$t('manage.title')" :description="$t('manage.description')">
    <template #header>
      <div class="flex space-x-2">
        <Button size="sm" @click="navigateToUpload">
          <Upload class="h-4 w-4 mr-2" />
          {{ $t("manage.uploadPlugin") }}
        </Button>
        <Button variant="outline" size="sm" @click="refreshPlugins">
          <RefreshCcw class="h-4 w-4 mr-2" />
          {{ $t("manage.refresh") }}
        </Button>
      </div>
    </template>

    <!-- Stats -->
    <div class="grid gap-4 md:grid-cols-3">
      <MetricCard
        :title="$t('manage.stats.customPlugins')"
        :metric="customPlugins.length"
        :subtitle="$t('manage.stats.uploadedByOrg')"
        :icon="Package"
      />
      <MetricCard
        :title="$t('manage.stats.enabled')"
        :metric="enabledCustomPlugins.length"
        :subtitle="$t('manage.stats.currentlyActive')"
        :icon="CheckCircle"
        subtitle-color="green"
      />
      <MetricCard
        :title="$t('manage.stats.totalSize')"
        :metric="formatTotalSize(totalSize)"
        :subtitle="$t('manage.stats.storageUsed')"
        :icon="HardDrive"
      />
    </div>

    <!-- Loading State -->
    <Card v-if="loading">
      <CardContent class="py-8">
        <div class="flex items-center justify-center">
          <RefreshCcw class="h-6 w-6 animate-spin text-neutral-muted" />
          <span class="ml-2 text-neutral-muted">{{ $t("manage.loading") }}</span>
        </div>
      </CardContent>
    </Card>

    <!-- Empty State -->
    <Card v-else-if="customPlugins.length === 0">
      <CardContent class="py-12 text-center">
        <Package class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
        <h3 class="text-lg font-medium mb-2">{{ $t("manage.empty.title") }}</h3>
        <p class="text-neutral-muted mb-4">
          {{ $t("manage.empty.description") }}
        </p>
        <Button @click="navigateToUpload">
          <Upload class="h-4 w-4 mr-2" />
          {{ $t("manage.uploadPlugin") }}
        </Button>
      </CardContent>
    </Card>

    <!-- Plugins Table -->
    <Card v-else>
      <CardHeader>
        <CardTitle>{{ $t("manage.table.title") }}</CardTitle>
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
              <div
                class="w-12 h-12 rounded-lg overflow-hidden bg-neutral-muted flex items-center justify-center"
              >
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
                    {{ $t("common.enabled") }}
                  </Badge>
                  <Badge v-else variant="secondary" class="text-xs">
                    {{ $t("common.disabled") }}
                  </Badge>
                </div>
                <div class="flex items-center space-x-4 text-sm text-neutral-muted mt-1">
                  <span>{{ $t("manage.table.version", { version: plugin.version }) }}</span>
                  <span>{{ $t("manage.table.id", { id: plugin.id }) }}</span>
                  <span v-if="plugin.uploadedAt">
                    {{ $t("manage.table.uploaded", { date: formatDateTime(plugin.uploadedAt) }) }}
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
                {{
                  enablingPlugin === plugin.id
                    ? $t("manage.actions.enabling")
                    : $t("manage.actions.enable")
                }}
              </Button>
              <Button
                v-else
                size="sm"
                variant="outline"
                :disabled="disablingPlugin === plugin.id"
                @click="disablePlugin(plugin.id)"
              >
                <Power class="h-3 w-3 mr-1" />
                {{
                  disablingPlugin === plugin.id
                    ? $t("manage.actions.disabling")
                    : $t("manage.actions.disable")
                }}
              </Button>

              <Button size="sm" variant="outline" @click="navigateToSettings(plugin.id)">
                <Settings class="h-3 w-3 mr-1" />
                {{ $t("manage.actions.settings") }}
              </Button>

              <Button size="sm" variant="outline" @click="updatePlugin(plugin.id)">
                <Upload class="h-3 w-3 mr-1" />
                {{ $t("manage.actions.update") }}
              </Button>

              <Button
                size="sm"
                variant="destructive"
                :disabled="deletingPlugin === plugin.id"
                @click="deletePlugin(plugin.id)"
              >
                <Trash2 class="h-3 w-3 mr-1" />
                {{
                  deletingPlugin === plugin.id
                    ? $t("manage.actions.deleting")
                    : $t("manage.actions.delete")
                }}
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

const { t } = useI18n();
const router = useRouter();
const { formatDateTime } = useOrgDateTime();
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
    toast.success(t("manage.toast.enabledSuccess"));
  } catch (error: any) {
    console.error("Failed to enable plugin:", error);
    toast.error(error.message || t("manage.toast.enableFailed"));
  } finally {
    enablingPlugin.value = null;
  }
};

const disablePlugin = async (pluginId: string) => {
  disablingPlugin.value = pluginId;
  try {
    await appStore.disablePlugin(pluginId);
    toast.success(t("manage.toast.disabledSuccess"));
  } catch (error: any) {
    console.error("Failed to disable plugin:", error);
    toast.error(error.message || t("manage.toast.disableFailed"));
  } finally {
    disablingPlugin.value = null;
  }
};

const deletePlugin = async (pluginId: string) => {
  if (!confirm(t("manage.confirmDelete"))) {
    return;
  }

  deletingPlugin.value = pluginId;
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
      throw new Error(error.error || t("manage.toast.deleteFailed"));
    }

    toast.success(t("manage.toast.deletedSuccess"));
    await appStore.fetchPlugins();
  } catch (error: any) {
    console.error("Failed to delete plugin:", error);
    toast.error(error.message || t("manage.toast.deleteFailed"));
  } finally {
    deletingPlugin.value = null;
  }
};

const updatePlugin = (pluginId: string) => {
  // TODO: Implement update flow
  toast.info(t("manage.updateComingSoon"));
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
  title: t("manage.headTitle"),
  meta: [
    {
      name: "description",
      content: t("manage.description"),
    },
  ],
});
</script>
