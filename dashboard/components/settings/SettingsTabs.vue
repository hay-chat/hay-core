<template>
  <nav
    v-if="tabs.length > 1"
    class="-mt-2 flex gap-1 overflow-x-auto border-b"
    :aria-label="$t('nav.settings')"
    data-testid="settings-tabs"
  >
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.path"
      :to="tab.path"
      :aria-current="isSettingsTabActive(tab, route.path) ? 'page' : undefined"
      :class="[
        'whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-all',
        isSettingsTabActive(tab, route.path)
          ? 'border-primary text-primary'
          : 'border-transparent text-neutral-muted hover:text-neutral-foreground',
      ]"
    >
      {{ $t(tab.labelKey) }}
    </NuxtLink>
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useUserStore } from "@/stores/user";

const route = useRoute();
const userStore = useUserStore();

// The tab bar of whichever section owns the current page; sections with one visible tab show none.
const tabs = computed(() => {
  const section = SETTINGS_NAV.find((s) =>
    s.tabs.some((tab) => isSettingsTabActive(tab, route.path)),
  );
  return section ? visibleSettingsTabs(section, !!userStore.isAdmin) : [];
});
</script>
