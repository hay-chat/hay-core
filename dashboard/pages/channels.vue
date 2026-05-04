<template>
  <Page :title="$t('channels.title')" :description="$t('channels.description')">
    <template #header>
      <Button variant="outline" size="sm" @click="goToMarketplace">
        <Store class="h-4 w-4 mr-2" />
        {{ $t("channels.browseMarketplace") }}
      </Button>
    </template>

    <Card v-if="loading">
      <CardContent class="py-8">
        <div class="flex items-center justify-center">
          <RefreshCcw class="h-6 w-6 animate-spin text-neutral-muted" />
          <span class="ml-2 text-neutral-muted">{{ $t("channels.loading") }}</span>
        </div>
      </CardContent>
    </Card>

    <Card v-else-if="channelPlugins.length === 0">
      <CardContent class="py-12 text-center">
        <Radio class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
        <h3 class="text-lg font-medium mb-2">{{ $t("channels.empty.title") }}</h3>
        <p class="text-neutral-muted mb-4">{{ $t("channels.empty.description") }}</p>
        <Button @click="goToMarketplace">
          <Store class="h-4 w-4 mr-2" />
          {{ $t("channels.empty.action") }}
        </Button>
      </CardContent>
    </Card>

    <div v-else class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Card
        v-for="plugin in channelPlugins"
        :key="plugin.id"
        class="hover:border-primary/50 transition-colors cursor-pointer"
        @click="openPluginSettings(plugin.id)"
      >
        <CardContent class="p-4">
          <div class="flex items-start space-x-4">
            <div
              class="w-12 h-12 rounded-lg overflow-hidden bg-neutral-muted flex items-center justify-center shrink-0"
            >
              <img
                :src="getPluginThumbnail(plugin.id)"
                :alt="`${plugin.name} thumbnail`"
                class="w-full h-full object-cover"
                @error="handleThumbnailError($event)"
              />
              <Radio class="h-6 w-6 text-neutral-muted hidden" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center space-x-2">
                <h4 class="font-medium truncate">{{ plugin.name }}</h4>
                <Badge variant="default" class="text-xs">{{ $t("common.enabled") }}</Badge>
              </div>
              <p v-if="plugin.description" class="text-sm text-neutral-muted mt-1 line-clamp-2">
                {{ plugin.description }}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </Page>
</template>

<script setup lang="ts">
import { Radio, RefreshCcw, Store } from "lucide-vue-next";
import { useAppStore } from "@/stores/app";
import { useDomain } from "@/composables/useDomain";

const { t } = useI18n();
const router = useRouter();
const appStore = useAppStore();
const { getApiUrl } = useDomain();

const loading = ref(true);

const channelPlugins = computed(() =>
  appStore.plugins.filter((p) => p.enabled && p.type?.includes("channel")),
);

const getPluginThumbnail = (pluginId: string) =>
  getApiUrl(`/plugins/thumbnails/${encodeURIComponent(pluginId)}`);

const handleThumbnailError = (event: Event) => {
  const imgElement = event.target as HTMLImageElement;
  const fallbackElement = imgElement.nextElementSibling as HTMLElement;
  imgElement.style.display = "none";
  if (fallbackElement) fallbackElement.style.display = "flex";
};

const openPluginSettings = (pluginId: string) => {
  router.push(`/integrations/plugins/${encodeURIComponent(pluginId)}`);
};

const goToMarketplace = () => {
  router.push("/integrations/marketplace");
};

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
});

useHead({
  title: t("channels.headTitle"),
  meta: [{ name: "description", content: t("channels.description") }],
});
</script>
