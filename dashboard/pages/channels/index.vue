<template>
  <Page :title="$t('channels.title')" :description="$t('channels.description')">
    <template #header>
      <Button variant="outline" size="sm" @click="goToMarketplace">
        <Store class="h-4 w-4 mr-2" />
        {{ $t("channels.browseMarketplace") }}
      </Button>
    </template>

    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <!-- Webchat: built in, always first, so the list is never empty -->
      <NuxtLink
        :to="webchatLink"
        class="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        data-testid="channel-webchat"
      >
        <Card class="h-full cursor-pointer transition-colors hover:border-primary/50">
          <CardContent class="p-4">
            <div class="flex items-start space-x-4">
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#e8f3ff] text-primary"
              >
                <MessageCircle class="h-6 w-6" aria-hidden="true" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center space-x-2">
                  <h4 class="truncate font-medium">{{ $t("webchat.title") }}</h4>
                  <WebchatStatusPill v-if="webchatStatus" :status="webchatStatus" />
                </div>
                <p class="mt-1 line-clamp-2 text-sm text-neutral-muted">{{ webchatText }}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </NuxtLink>

      <template v-if="!loading">
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
      </template>

      <!-- Add a channel: always last -->
      <NuxtLink
        to="/integrations/marketplace"
        class="flex min-h-[88px] items-center gap-4 rounded-lg border border-dashed border-neutral-300 p-4 text-left transition-colors hover:border-neutral-400 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        data-testid="channel-add"
      >
        <span
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500"
        >
          <Plus class="h-5 w-5" aria-hidden="true" />
        </span>
        <span class="min-w-0">
          <span class="block font-medium text-neutral-900">{{ $t("channels.add.title") }}</span>
          <span class="block text-sm text-neutral-muted">{{ $t("channels.add.description") }}</span>
        </span>
      </NuxtLink>
    </div>
  </Page>
</template>

<script setup lang="ts">
import { MessageCircle, Plus, Radio, Store } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useAppStore } from "@/stores/app";
import { useDomain } from "@/composables/useDomain";
import {
  webchatInstallStatus,
  webchatLandingTab,
  websiteHost,
  type WebchatInstallStatus,
} from "@/utils/webchat-settings";

const { t } = useI18n();
const router = useRouter();
const appStore = useAppStore();
const { getApiUrl } = useDomain();

const loading = ref(true);

const channelPlugins = computed(() =>
  appStore.plugins.filter((p) => p.enabled && p.type?.includes("channel")),
);

// Webchat is built in: its card reads the webchat settings, not the plugin list.
const webchat = ref<{
  isEnabled: boolean;
  lastSeenAt: string | null;
  lastSeenOrigin: string | null;
} | null>(null);
const webchatStatus = computed<WebchatInstallStatus | null>(() =>
  webchat.value ? webchatInstallStatus(webchat.value.isEnabled, webchat.value.lastSeenAt) : null,
);
const webchatLink = computed(() => ({
  path: "/channels/webchat",
  query: { tab: webchatLandingTab(webchat.value?.lastSeenAt) },
}));
const webchatText = computed(() => {
  const host = websiteHost(webchat.value?.lastSeenOrigin);
  if (webchatStatus.value === "live" && host) return t("channels.webchat.liveOn", { host });
  if (webchatStatus.value === "off") return t("channels.webchat.off");
  if (webchatStatus.value === "notInstalled") return t("channels.webchat.notInstalled");
  return t("channels.webchat.description");
});

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
  const [settings] = await Promise.allSettled([
    Hay.webchat.getSettings.query(),
    appStore.fetchPlugins(),
  ]);
  if (settings.status === "fulfilled") {
    webchat.value = {
      isEnabled: settings.value.isEnabled,
      lastSeenAt: settings.value.lastSeenAt,
      lastSeenOrigin: settings.value.lastSeenOrigin,
    };
  }
  loading.value = false;
});

definePageMeta({
  layout: "default",
});

useHead({
  title: t("channels.headTitle"),
  meta: [{ name: "description", content: t("channels.description") }],
});
</script>
