<template>
  <Page :description="$t('webchat.description')" width="max">
    <template #title>
      <NuxtLink
        to="/channels"
        class="mb-2 flex w-fit items-center gap-1 font-sans text-sm font-medium text-neutral-500 hover:text-neutral-700"
      >
        <ChevronLeft class="h-4 w-4" aria-hidden="true" />
        {{ $t("nav.channels") }}
      </NuxtLink>
      {{ $t("webchat.title") }}
    </template>
    <template #header>
      <div v-if="!state.loading.value && !state.loadFailed.value" class="flex items-center gap-3">
        <WebchatStatusPill :status="savedStatus" />
        <Input
          v-model="form.isEnabled"
          type="switch"
          :label="$t('webchat.showOnWebsite')"
          data-testid="webchat-enabled"
        />
      </div>
    </template>

    <Alert v-if="state.loadFailed.value" variant="destructive" data-testid="settings-load-error">
      <AlertTitle>{{ $t("webchat.loadFailed") }}</AlertTitle>
      <AlertDescription>
        <Button variant="outline" size="sm" class="mt-2" @click="state.load">
          {{ $t("common.tryAgain") }}
        </Button>
      </AlertDescription>
    </Alert>

    <Loading v-else-if="state.loading.value" />

    <template v-else>
      <nav class="-mt-2 flex gap-1 overflow-x-auto border-b" :aria-label="$t('webchat.tabsLabel')">
        <NuxtLink
          v-for="id in WEBCHAT_TABS"
          :key="id"
          :to="{ query: { ...route.query, tab: id } }"
          replace
          :aria-current="tab === id ? 'page' : undefined"
          :data-testid="`webchat-tab-${id}`"
          :class="[
            'whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-all',
            tab === id
              ? 'border-primary text-primary'
              : 'border-transparent text-neutral-muted hover:text-neutral-foreground',
          ]"
        >
          {{ $t(`webchat.tabs.${id}`) }}
        </NuxtLink>
      </nav>

      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div class="min-w-0 divide-y divide-neutral-200">
          <WebchatAppearanceTab v-if="tab === 'appearance'" />
          <WebchatContentTab v-else-if="tab === 'content'" />
          <WebchatInstallTab v-else-if="tab === 'install'" />
          <WebchatSecurityTab v-else />
        </div>

        <WebchatPreview />
      </div>

      <!-- Only while something changed. Logo, under-attack mode and the secret act straight away. -->
      <div
        v-if="state.isDirty.value"
        class="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-[0_10px_15px_-3px_rgb(0_0_0/0.1),0_4px_6px_-4px_rgb(0_0_0/0.1)]"
        role="region"
        :aria-label="$t('webchat.saveBar.label')"
        data-testid="webchat-save-bar"
      >
        <p class="min-w-0 flex-1 text-sm text-neutral-700">{{ $t("webchat.saveBar.unsaved") }}</p>
        <Button variant="outline" :disabled="state.saving.value" @click="state.discard">
          {{ $t("webchat.saveBar.discard") }}
        </Button>
        <Button :loading="state.saving.value" @click="state.save">
          {{ $t("webchat.saveBar.save") }}
        </Button>
      </div>
    </template>
  </Page>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { ChevronLeft } from "lucide-vue-next";
import { provideWebchatSettings } from "@/composables/useWebchatSettings";
import { WEBCHAT_TABS, parseWebchatTab, webchatInstallStatus } from "@/utils/webchat-settings";

const { t } = useI18n();
const route = useRoute();

const state = provideWebchatSettings();
const form = state.form;

const tab = computed(() => parseWebchatTab(route.query.tab));
const savedStatus = computed(() =>
  webchatInstallStatus(state.saved.value.isEnabled, state.lastSeenAt.value),
);

onMounted(() => {
  state.load();
});

definePageMeta({ layout: "default" });

useHead({ title: computed(() => t("webchat.headTitle")) });
</script>
