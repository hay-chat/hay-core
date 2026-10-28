<template>
  <div data-testid="version-diff">
    <div v-if="loading" class="flex justify-center py-4">
      <Loading />
    </div>
    <p v-else-if="failed" class="text-xs text-destructive">
      {{ t("versioning.diff.loadFailed") }}
    </p>
    <template v-else-if="comparison">
      <p class="text-xs text-neutral-muted mb-2">
        {{
          comparison.active
            ? t("versioning.diff.against", { version: comparison.active.versionNumber })
            : t("versioning.diff.neverPublished")
        }}
      </p>
      <p
        v-if="comparison.currentMarkdown === comparison.revisedMarkdown"
        class="text-xs text-neutral-muted"
        data-testid="version-diff-same"
      >
        {{ t("versioning.diff.noChanges") }}
      </p>
      <div v-else class="max-h-[50vh] overflow-y-auto">
        <InstructionsDiff
          :current-markdown="comparison.currentMarkdown"
          :revised-markdown="comparison.revisedMarkdown"
          :references="comparison.references"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { HayApi } from "@/utils/api";

/** D7-6: a playbook version (default: the draft) diffed against the active one. */
const props = defineProps<{
  playbookId: string;
  versionId?: string;
}>();

const { t } = useI18n();

type Comparison = Awaited<ReturnType<typeof HayApi.playbooks.versions.compare.query>>;

const loading = ref(false);
const failed = ref(false);
const comparison = ref<Comparison | null>(null);

const load = async () => {
  loading.value = true;
  failed.value = false;
  try {
    comparison.value = await HayApi.playbooks.versions.compare.query({
      playbookId: props.playbookId,
      versionId: props.versionId,
    });
  } catch (error) {
    console.error("Failed to load version diff:", error);
    failed.value = true;
  } finally {
    loading.value = false;
  }
};

watch(() => [props.playbookId, props.versionId], load, { immediate: true });
</script>
