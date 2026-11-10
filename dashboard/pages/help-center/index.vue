<template>
  <Page :title="$t('helpCenter.title')" :description="$t('helpCenter.description')">
    <div v-if="loading" class="py-12 text-center">
      <Loading :label="$t('helpCenter.loading')" />
    </div>

    <div
      v-else-if="!state"
      class="flex flex-col items-center gap-3 py-16 text-center"
      role="alert"
      data-testid="help-center-load-error"
    >
      <p class="font-medium text-foreground">{{ $t("helpCenter.loadFailed") }}</p>
      <Button variant="outline" @click="load">{{ $t("helpCenter.tryAgain") }}</Button>
    </div>

    <!-- This server has no help center domain -->
    <Card v-else-if="!state.enabled" data-testid="help-center-disabled">
      <CardContent class="pt-6">
        <EmptyState
          :title="$t('helpCenter.disabled.title')"
          :description="$t('helpCenter.disabled.description')"
        />
      </CardContent>
    </Card>

    <HelpCenterSetupWizard
      v-else-if="!state.helpCenter"
      :base-domain="state.baseDomain"
      :suggested-subdomain="state.suggestedSubdomain"
      data-testid="help-center-setup"
      @created="load"
    />

    <template v-else>
      <Alert v-if="!state.helpCenter.isPublished" variant="info" data-testid="not-live-notice">
        <AlertTitle>{{ $t("helpCenter.notLive.title") }}</AlertTitle>
        <AlertDescription>{{ $t("helpCenter.notLive.description") }}</AlertDescription>
      </Alert>

      <Tabs default-value="overview">
        <TabsList>
          <TabsTrigger value="overview">{{ $t("helpCenter.tabs.overview") }}</TabsTrigger>
          <TabsTrigger value="content">{{ $t("helpCenter.tabs.content") }}</TabsTrigger>
          <TabsTrigger value="appearance">
            {{ $t("helpCenter.tabs.appearance") }}
            <template v-if="themeDirty">
              <span class="ml-1 inline-block h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
              <span class="sr-only">{{ $t("helpCenter.unsaved.marker") }}</span>
            </template>
          </TabsTrigger>
          <TabsTrigger value="domain">{{ $t("helpCenter.tabs.domain") }}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <HelpCenterOverviewTab
            :help-center="state.helpCenter"
            :base-domain="state.baseDomain"
            :collections="collections"
            :preview-link="previewLink"
            @updated="applyHelpCenter"
          />
        </TabsContent>
        <TabsContent value="content">
          <HelpCenterContentTab
            :collections="collections"
            :load-failed="collectionsFailed"
            @changed="loadCollections"
          />
        </TabsContent>
        <TabsContent value="appearance">
          <HelpCenterAppearanceTab
            v-model="themeDraft"
            :dirty="themeDirty"
            :preview-link="previewLink"
            @reset="themeDraft = { ...savedTheme }"
            @updated="applySavedTheme"
          />
        </TabsContent>
        <TabsContent value="domain">
          <HelpCenterDomainTab
            :help-center="state.helpCenter"
            @updated="applyHelpCenter"
            @refresh="refresh"
          />
        </TabsContent>
      </Tabs>
    </template>

    <ConfirmDialog
      v-model:open="showConfirmDialog"
      :title="$t('helpCenter.unsaved.title')"
      :description="$t('helpCenter.unsaved.description')"
      :confirm-text="$t('helpCenter.unsaved.leave')"
      :destructive="true"
      @confirm="confirmDialogConfig.onConfirm"
      @cancel="handleDialogCancel"
    />
  </Page>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useIntervalFn } from "@vueuse/core";
import { Hay } from "@/utils/api";
import { useUnsavedChanges } from "@/composables/useUnsavedChanges";
import {
  DEFAULT_HELP_CENTER_THEME,
  type HelpCenterCollection,
  type HelpCenterPreviewLink,
  type HelpCenterState,
  type HelpCenterTheme,
  type HelpCenterView,
} from "@/utils/help-center";
import HelpCenterSetupWizard from "@/components/help-center/HelpCenterSetupWizard.vue";
import HelpCenterOverviewTab from "@/components/help-center/HelpCenterOverviewTab.vue";
import HelpCenterContentTab from "@/components/help-center/HelpCenterContentTab.vue";
import HelpCenterAppearanceTab from "@/components/help-center/HelpCenterAppearanceTab.vue";
import HelpCenterDomainTab from "@/components/help-center/HelpCenterDomainTab.vue";

/** Preview links last an hour; a fresh one well before that keeps the preview working. */
const PREVIEW_LINK_REFRESH_MS = 45 * 60 * 1000;

const { t } = useI18n();

const state = ref<HelpCenterState | null>(null);
const loading = ref(true);

// The theme being edited lives here, not in the Appearance tab, so that switching
// tabs keeps it and leaving the page with unsaved changes asks first.
const savedTheme = ref<HelpCenterTheme>({ ...DEFAULT_HELP_CENTER_THEME });
const themeDraft = ref<HelpCenterTheme>({ ...DEFAULT_HELP_CENTER_THEME });
const {
  hasUnsavedChanges: themeDirty,
  showConfirmDialog,
  confirmDialogConfig,
  handleDialogCancel,
} = useUnsavedChanges(savedTheme, themeDraft);

function applySavedTheme(helpCenter: HelpCenterView) {
  if (state.value) state.value = { ...state.value, helpCenter };
  savedTheme.value = { ...helpCenter.theme };
  themeDraft.value = { ...helpCenter.theme };
}

/** A save from another tab: keep a theme that is still being edited. */
function applyHelpCenter(helpCenter: HelpCenterView) {
  const draft = themeDirty.value ? themeDraft.value : null;
  applySavedTheme(helpCenter);
  if (draft) themeDraft.value = draft;
}

/** Re-reads the help center without replacing the page with a spinner. */
async function refresh() {
  try {
    const next = await Hay.helpCenter.get.query();
    state.value = next;
    if (next.helpCenter) applyHelpCenter(next.helpCenter);
  } catch (error) {
    console.error("Failed to load the help center:", error);
    state.value = null;
  }
}

async function load() {
  loading.value = true;
  await refresh();
  loading.value = false;
}

// --- Collections (shown in Content, counted in Overview) ---
const collections = ref<HelpCenterCollection[]>([]);
const collectionsFailed = ref(false);

async function loadCollections() {
  try {
    collections.value = await Hay.helpCenter.listCollections.query();
    collectionsFailed.value = false;
  } catch (error) {
    console.error("Failed to load help center collections:", error);
    collectionsFailed.value = true;
  }
}

// --- Preview link (Overview button, Appearance frame) ---
const previewLink = ref<HelpCenterPreviewLink | null>(null);

async function loadPreviewLink() {
  if (!state.value?.helpCenter) return;
  try {
    previewLink.value = await Hay.helpCenter.getPreviewLink.query();
  } catch (error) {
    console.error("Failed to get a help center preview link:", error);
    previewLink.value = null;
  }
}
useIntervalFn(loadPreviewLink, PREVIEW_LINK_REFRESH_MS);

watch(
  () => state.value?.helpCenter?.id,
  (id) => {
    if (id) void loadCollections();
  },
);
// The preview always uses the built-in address, which follows the subdomain.
watch(
  () => state.value?.helpCenter?.subdomain,
  () => void loadPreviewLink(),
);

onMounted(load);

definePageMeta({ layout: "default" });
useHead({ title: t("helpCenter.title") });
</script>
