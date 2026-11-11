<template>
  <Page :title="$t('marketplace.title')" :description="$t('marketplace.description')">
    <template v-if="userStore.isAdmin" #header>
      <Button
        v-if="customPluginsCount > 0"
        variant="outline"
        size="sm"
        @click="router.push('/integrations/plugins/manage')"
      >
        <Settings class="h-4 w-4 mr-2" aria-hidden="true" />
        {{ $t("marketplace.manageCustom", { count: customPluginsCount }) }}
      </Button>
      <Button variant="outline" size="sm" @click="router.push('/integrations/plugins/upload')">
        <Upload class="h-4 w-4 mr-2" aria-hidden="true" />
        {{ $t("marketplace.uploadPlugin") }}
      </Button>
    </template>

    <div class="space-y-7">
      <!-- Search and categories -->
      <div class="space-y-3">
        <div class="max-w-xl">
          <Input
            v-model="searchQuery"
            type="search"
            :icon-start="Search"
            :aria-label="$t('marketplace.search.label')"
            :placeholder="$t('marketplace.search.placeholder')"
            data-testid="marketplace-search"
          />
        </div>
        <div
          role="group"
          :aria-label="$t('marketplace.categories.label')"
          class="flex flex-wrap gap-2"
        >
          <FilterPill
            v-for="pill in categoryPills"
            :key="pill.id"
            :pressed="selectedCategory === pill.id"
            :count="pill.count"
            :data-testid="`marketplace-category-${pill.id}`"
            @click="selectedCategory = pill.id"
          >
            {{ pill.label }}
          </FilterPill>
        </div>
      </div>

      <!-- Loading -->
      <div
        v-if="loading"
        class="grid gap-4 grid-cols-[repeat(auto-fill,minmax(16.25rem,1fr))]"
        aria-busy="true"
      >
        <div v-for="i in 8" :key="i" class="h-36 rounded-xl bg-muted animate-pulse"></div>
      </div>

      <template v-else>
        <!-- Connected -->
        <section
          v-if="showConnected"
          aria-labelledby="marketplace-connected"
          class="space-y-3"
          data-testid="marketplace-connected"
        >
          <div class="flex items-baseline gap-2.5">
            <h2 id="marketplace-connected" class="text-lg font-semibold">
              {{ $t("marketplace.connected.title") }}
            </h2>
            <span class="text-sm text-neutral-muted">{{ connectedPlugins.length }}</span>
          </div>
          <ul class="divide-y divide-border overflow-hidden rounded-xl border border-border">
            <li
              v-for="plugin in connectedPlugins"
              :key="plugin.id"
              class="flex flex-wrap items-center gap-3 bg-background px-4 py-3"
            >
              <PluginLogo :plugin-id="plugin.id" class="h-9 w-9 rounded-lg" />
              <div class="min-w-0 flex-1 basis-48">
                <p class="font-semibold truncate">{{ plugin.name }}</p>
                <p class="text-sm text-neutral-muted">{{ sectionLabel(plugin) }}</p>
              </div>
              <Badge :variant="plugin.status === 'connected' ? 'success' : 'warning'">
                <span
                  :class="[
                    'mr-1.5 inline-block h-1.5 w-1.5 rounded-full',
                    plugin.status === 'connected' ? 'bg-green-600' : 'bg-amber-600',
                  ]"
                  aria-hidden="true"
                ></span>
                {{
                  plugin.status === "connected"
                    ? $t("marketplace.status.connected")
                    : $t("marketplace.status.finishSetup")
                }}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                :aria-label="$t('marketplace.connected.configureNamed', { name: plugin.name })"
                @click="router.push(pluginDetailPath(plugin.id))"
              >
                {{ $t("marketplace.connected.configure") }}
              </Button>
            </li>
          </ul>
        </section>

        <!-- Sections by category -->
        <section
          v-for="section in sections"
          :key="section.id"
          :aria-labelledby="`marketplace-section-${section.id}`"
          class="space-y-3.5"
          :data-testid="`marketplace-section-${section.id}`"
        >
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 :id="`marketplace-section-${section.id}`" class="text-lg font-semibold">
              {{ $t(`marketplace.sections.${section.id}.label`) }}
            </h2>
            <p class="text-sm text-neutral-muted">
              {{ $t(`marketplace.sections.${section.id}.blurb`) }}
            </p>
          </div>
          <ul class="grid gap-4 grid-cols-[repeat(auto-fill,minmax(16.25rem,1fr))]">
            <li v-for="plugin in section.plugins" :key="plugin.id" class="flex">
              <NuxtLink
                :to="pluginDetailPath(plugin.id)"
                class="flex w-full flex-col gap-3 rounded-xl border border-border bg-background p-4 transition-[border-color,box-shadow] hover:border-neutral-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                data-testid="marketplace-card"
              >
                <div class="flex items-center gap-3">
                  <PluginLogo :plugin-id="plugin.id" class="h-10 w-10 rounded-lg" />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <h3 class="min-w-0 truncate text-[15px] font-semibold">{{ plugin.name }}</h3>
                      <PluginStatusDot v-if="plugin.status" :status="plugin.status" />
                      <Badge v-if="plugin.isCustom" variant="outline" class="ml-auto">
                        {{ $t("marketplace.custom") }}
                      </Badge>
                    </div>
                    <p v-if="plugin.kind" class="truncate text-xs text-neutral-muted">
                      {{ plugin.kind }}
                    </p>
                  </div>
                </div>
                <p class="min-h-14 flex-1 text-[13px] text-neutral-muted line-clamp-3">
                  {{ plugin.summary }}
                </p>
              </NuxtLink>
            </li>
          </ul>
        </section>

        <!-- No results -->
        <div
          v-if="sections.length === 0"
          class="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-neutral-300 px-6 py-10 text-center"
          data-testid="marketplace-empty"
        >
          <h2 class="text-lg font-semibold">{{ $t("marketplace.empty.title") }}</h2>
          <p class="max-w-md text-neutral-muted">{{ $t("marketplace.empty.description") }}</p>
          <div class="mt-1.5 flex flex-wrap justify-center gap-2">
            <Button variant="outline" @click="clearFilters">
              {{ $t("marketplace.empty.clear") }}
            </Button>
            <Button :href="requestUrl" target="_blank">
              {{ $t("marketplace.requestIntegration") }}
            </Button>
          </div>
        </div>
      </template>

      <!-- Build or request -->
      <section
        aria-labelledby="marketplace-footer"
        class="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-muted p-6"
      >
        <div class="min-w-0 flex-1 basis-80">
          <h2 id="marketplace-footer" class="text-lg font-semibold">
            {{ $t("marketplace.footer.title") }}
          </h2>
          <p class="mt-1 text-neutral-muted">{{ $t("marketplace.footer.description") }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" :href="PLUGIN_DOCS_URL" target="_blank">
            {{ $t("marketplace.footer.docs") }}
          </Button>
          <Button :href="requestUrl" target="_blank">
            {{ $t("marketplace.requestIntegration") }}
          </Button>
        </div>
      </section>
    </div>
  </Page>
</template>

<script setup lang="ts">
import { Search, Settings, Upload } from "lucide-vue-next";
import { useAppStore } from "@/stores/app";
import { useUserStore } from "@/stores/user";
import {
  MARKETPLACE_SECTIONS,
  PLUGIN_DOCS_URL,
  capabilityTags,
  matchesSearch,
  pluginDetailPath,
  requestIntegrationUrl,
  sectionOf,
  type MarketplaceSection,
} from "@/utils/marketplace";

const { t, locale } = useI18n();
const router = useRouter();
const route = useRoute();
const appStore = useAppStore();
const userStore = useUserStore();

const searchQuery = ref("");
// A plugin page's breadcrumb links back here with its category preselected.
const selectedCategory = ref<"all" | MarketplaceSection>(
  MARKETPLACE_SECTIONS.find((section) => section === route.query.category) ?? "all",
);

// Only the first load shows the skeleton; later refreshes keep the list on screen.
const loading = computed(() => appStore.pluginsLoading && appStore.plugins.length === 0);

const customPluginsCount = computed(() => appStore.plugins.filter((p) => p.isCustom).length);
const requestUrl = computed(() => requestIntegrationUrl(locale.value));

// Every plugin, enabled or not, with what a card shows.
const plugins = computed(() =>
  appStore.plugins.map((plugin) => {
    const section = sectionOf(plugin);
    const tags = capabilityTags(plugin).map((tag) => t(`marketplace.tags.${tag}`));
    return {
      id: plugin.id,
      name: plugin.name,
      summary: plugin.summary,
      isCustom: plugin.isCustom,
      section,
      // The card has room for two; the detail page lists them all.
      kind: tags.slice(0, 2).join(" · "),
      status: appStore.pluginStatus(plugin.id),
      searchTexts: [
        plugin.name,
        plugin.summary,
        plugin.description,
        ...tags,
        t(`marketplace.sections.${section}.label`),
      ],
    };
  }),
);

const sectionLabel = (plugin: { section: MarketplaceSection }) =>
  t(`marketplace.sections.${plugin.section}.label`);

const categoryPills = computed(() => [
  { id: "all" as const, label: t("marketplace.categories.all"), count: plugins.value.length },
  ...MARKETPLACE_SECTIONS.map((id) => ({
    id,
    label: t(`marketplace.sections.${id}.label`),
    count: plugins.value.filter((plugin) => plugin.section === id).length,
  })).filter((pill) => pill.count > 0),
]);

const sections = computed(() => {
  const visible = plugins.value.filter(
    (plugin) =>
      (selectedCategory.value === "all" || plugin.section === selectedCategory.value) &&
      matchesSearch(plugin.searchTexts, searchQuery.value),
  );
  return MARKETPLACE_SECTIONS.map((id) => ({
    id,
    plugins: visible.filter((plugin) => plugin.section === id),
  })).filter((section) => section.plugins.length > 0);
});

const connectedPlugins = computed(() => plugins.value.filter((plugin) => plugin.status));
const showConnected = computed(
  () =>
    !searchQuery.value.trim() &&
    selectedCategory.value === "all" &&
    connectedPlugins.value.length > 0,
);

const clearFilters = () => {
  searchQuery.value = "";
  selectedCategory.value = "all";
};

onMounted(() => {
  void appStore.fetchPlugins();
});

definePageMeta({
  layout: "default",
});

useHead({
  title: t("marketplace.headTitle"),
  meta: [{ name: "description", content: t("marketplace.description") }],
});
</script>
