<template>
  <div class="space-y-4">
    <Card>
      <CardHeader>
        <div class="flex flex-wrap items-center gap-2">
          <CardTitle>{{ $t("helpCenter.overview.statusTitle") }}</CardTitle>
          <Badge :variant="helpCenter.isPublished ? 'success' : 'secondary'" data-testid="status">
            {{ helpCenter.isPublished ? $t("helpCenter.live") : $t("helpCenter.offline") }}
          </Badge>
        </div>
        <CardDescription>
          {{
            helpCenter.isPublished
              ? $t("helpCenter.overview.liveDescription")
              : $t("helpCenter.overview.offlineDescription")
          }}
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          <a
            :href="helpCenter.url"
            target="_blank"
            rel="noopener noreferrer"
            class="break-all text-sm font-medium text-primary hover:underline"
          >
            {{ helpCenter.url }}
          </a>
          <HelpCenterCopyButton
            :value="helpCenter.url"
            :label="$t('helpCenter.overview.copyAddress')"
          />
        </div>
        <p class="text-sm text-neutral-muted">
          {{
            $t("helpCenter.overview.liveArticles", { count: liveArticleCount }, liveArticleCount)
          }}
        </p>
        <div class="flex flex-wrap gap-2">
          <Button v-if="helpCenter.isPublished" variant="outline" @click="confirming = 'offline'">
            {{ $t("helpCenter.overview.goOffline") }}
          </Button>
          <Button v-else @click="confirming = 'live'">
            {{ $t("helpCenter.overview.goLive") }}
          </Button>
          <Button
            v-if="previewLink"
            variant="outline"
            :href="previewUrl(previewLink)"
            target="_blank"
          >
            <ExternalLink class="mr-2 h-4 w-4" />
            {{ $t("helpCenter.overview.preview") }}
            <span class="sr-only">{{ $t("helpCenter.opensInNewTab") }}</span>
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>{{ $t("helpCenter.overview.detailsTitle") }}</CardTitle>
        <CardDescription>{{ $t("helpCenter.overview.detailsDescription") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <HelpCenterBasicsFields
          v-model="form.basics"
          v-model:address-ok="addressOk"
          :base-domain="baseDomain"
          :current-subdomain="helpCenter.subdomain"
        />
        <p
          v-if="form.basics.subdomain !== helpCenter.subdomain"
          class="text-sm text-amber-700"
          role="note"
        >
          {{ $t("helpCenter.overview.addressChangeWarning") }}
        </p>
        <Input
          id="hc-search-indexing"
          :model-value="form.searchIndexing"
          type="switch"
          :label="$t('helpCenter.overview.searchIndexing')"
          :hint="$t('helpCenter.overview.searchIndexingHint')"
          @update:model-value="form.searchIndexing = $event === true"
        />
        <div class="flex justify-end gap-2">
          <Button variant="outline" :disabled="!hasChanges || saving" @click="reset">
            {{ $t("helpCenter.reset") }}
          </Button>
          <Button :loading="saving" :disabled="!hasChanges || !canSave" @click="save">
            {{ $t("helpCenter.saveChanges") }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <ConfirmDialog
      :open="confirming === 'live'"
      :title="$t('helpCenter.overview.goLiveTitle')"
      :description="
        $t(
          'helpCenter.overview.goLiveDescription',
          { count: liveArticleCount, url: helpCenter.url },
          liveArticleCount,
        )
      "
      :confirm-text="$t('helpCenter.overview.goLive')"
      :loading="publishing"
      @update:open="closeConfirm"
      @confirm="setPublished(true)"
    />
    <ConfirmDialog
      :open="confirming === 'offline'"
      :title="$t('helpCenter.overview.goOfflineTitle')"
      :description="$t('helpCenter.overview.goOfflineDescription')"
      :confirm-text="$t('helpCenter.overview.goOffline')"
      :destructive="true"
      :loading="publishing"
      @update:open="closeConfirm"
      @confirm="setPublished(false)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ExternalLink } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import {
  errorMessage,
  isHelpCenterLanguage,
  previewUrl,
  type HelpCenterBasics,
  type HelpCenterCollection,
  type HelpCenterPreviewLink,
  type HelpCenterView,
} from "@/utils/help-center";
import HelpCenterBasicsFields from "./HelpCenterBasicsFields.vue";
import HelpCenterCopyButton from "./HelpCenterCopyButton.vue";

const props = defineProps<{
  helpCenter: HelpCenterView;
  baseDomain: string;
  collections: HelpCenterCollection[];
  previewLink: HelpCenterPreviewLink | null;
}>();

const emit = defineEmits<{ updated: [helpCenter: HelpCenterView] }>();

const { t } = useI18n();
const toast = useToast();

const liveArticleCount = computed(
  () => props.collections.flatMap((collection) => collection.articles).filter((a) => a.live).length,
);

// --- Go live / go offline ---
const confirming = ref<"live" | "offline" | null>(null);
const publishing = ref(false);

function closeConfirm(open: boolean) {
  if (!open) confirming.value = null;
}

async function setPublished(published: boolean) {
  publishing.value = true;
  try {
    emit("updated", await Hay.helpCenter.setPublished.mutate({ published }));
    toast.success(t(published ? "helpCenter.overview.nowLive" : "helpCenter.overview.nowOffline"));
    confirming.value = null;
  } catch (error) {
    console.error("Failed to change the help center status:", error);
    toast.error(t("helpCenter.saveFailed"), errorMessage(error));
  } finally {
    publishing.value = false;
  }
}

// --- Name, address, language, indexing ---
interface OverviewForm {
  basics: HelpCenterBasics;
  searchIndexing: boolean;
}

function savedForm(): OverviewForm {
  return {
    basics: {
      name: props.helpCenter.name,
      subdomain: props.helpCenter.subdomain,
      language: props.helpCenter.defaultLanguage,
    },
    searchIndexing: props.helpCenter.searchIndexing,
  };
}

const form = ref(savedForm());
const addressOk = ref(true);
const saving = ref(false);

const hasChanges = computed(() => JSON.stringify(form.value) !== JSON.stringify(savedForm()));
const canSave = computed(() => form.value.basics.name.trim() !== "" && addressOk.value);

function reset() {
  form.value = savedForm();
}
watch(() => props.helpCenter, reset);

async function save() {
  const { name, subdomain, language } = form.value.basics;
  if (!isHelpCenterLanguage(language)) return;
  saving.value = true;
  try {
    const updated = await Hay.helpCenter.update.mutate({
      name: name.trim(),
      defaultLanguage: language,
      searchIndexing: form.value.searchIndexing,
      ...(subdomain !== props.helpCenter.subdomain && { subdomain }),
    });
    emit("updated", updated);
    toast.success(t("helpCenter.saved"));
  } catch (error) {
    console.error("Failed to save the help center:", error);
    toast.error(t("helpCenter.saveFailed"), errorMessage(error));
  } finally {
    saving.value = false;
  }
}
</script>
