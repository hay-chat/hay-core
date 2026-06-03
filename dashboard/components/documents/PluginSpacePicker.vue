<template>
  <div class="space-y-6">
    <div class="space-y-1">
      <h3 class="text-base font-medium">Pick a {{ rootTermPlural }} to sync</h3>
      <p class="text-sm text-neutral-muted">
        We'll create a document source for the selected {{ rootTerm }} and run the first sync now.
      </p>
    </div>

    <!-- Loading roots -->
    <div v-if="loadingRoots" class="flex items-center gap-2 text-sm text-neutral-muted">
      <Loader2 class="h-4 w-4 animate-spin" />
      Loading {{ rootTermPlural }}…
    </div>

    <Alert v-else-if="rootsError" variant="destructive">
      <AlertTitle>Could not load {{ rootTermPlural }}</AlertTitle>
      <AlertDescription>{{ rootsError }}</AlertDescription>
    </Alert>

    <div v-else-if="roots.length === 0" class="rounded-lg border p-6 text-center">
      <p class="text-sm text-neutral-muted">No {{ rootTermPlural }} were returned by the plugin.</p>
    </div>

    <div
      v-else
      class="space-y-2 max-h-80 overflow-y-auto border rounded-lg p-2"
      data-testid="space-picker-list"
    >
      <button
        v-for="root in roots"
        :key="root.id"
        type="button"
        :data-testid="`space-row-${root.id}`"
        class="w-full flex items-center justify-between gap-3 p-3 rounded-lg border-2 text-left transition-colors hover:border-primary"
        :class="selectedRootId === root.id ? 'border-primary bg-primary/5' : 'border-transparent'"
        @click="selectRoot(root)"
      >
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium truncate">{{ root.label }}</p>
          <p class="text-xs text-neutral-muted truncate">{{ root.id }}</p>
        </div>
        <p
          v-if="typeof root.metadata?.pageCount === 'number'"
          class="text-xs text-neutral-muted shrink-0 tabular-nums"
        >
          {{ root.metadata.pageCount }} {{ root.metadata.pageCount === 1 ? "page" : "pages" }}
        </p>
        <CheckCircle v-if="selectedRootId === root.id" class="h-5 w-5 text-primary shrink-0" />
      </button>
    </div>

    <div v-if="roots.length > 0" class="space-y-4 pt-2">
      <Input
        v-model="displayName"
        type="text"
        label="Display name"
        placeholder="Used to identify this source in your library"
        data-testid="space-picker-display-name"
      />

      <Input
        v-model="syncIntervalValue"
        type="select"
        label="Sync frequency"
        :options="syncIntervalOptions"
        data-testid="space-picker-sync-interval"
      />
    </div>

    <Alert v-if="submitError" variant="destructive">
      <AlertTitle>Failed to create source</AlertTitle>
      <AlertDescription>{{ submitError }}</AlertDescription>
    </Alert>

    <div class="flex justify-end pt-2">
      <Button
        :loading="submitting"
        :disabled="!canSubmit"
        data-testid="space-picker-submit"
        @click="handleSubmit"
      >
        Connect &amp; sync now
        <ChevronRight class="ml-2 h-4 w-4" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { Loader2, CheckCircle, ChevronRight } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

interface PluginImporter {
  id: string;
  pluginId: string;
  name: string;
  description: string;
  icon?: string;
  thumbnail?: string | null;
  connected: boolean;
  sourceIds?: string[];
}

interface Root {
  id: string;
  label: string;
  metadata?: Record<string, unknown>;
}

const props = defineProps<{
  plugin: PluginImporter;
  instanceId: string;
}>();

const emit = defineEmits<{
  sourceCreated: [payload: { sourceId: string }];
}>();

const toast = useToast();

// Confluence-speak "space" vs generic "root" — pick a sensible label per plugin.
const rootTerm = computed(() => {
  const id = props.plugin.pluginId.toLowerCase();
  if (id.includes("atlassian") || id.includes("confluence")) return "space";
  if (id.includes("notion")) return "database";
  if (id.includes("github")) return "repository";
  return "source";
});
const rootTermPlural = computed(() => `${rootTerm.value}s`);

const loadingRoots = ref(true);
const rootsError = ref<string | null>(null);
const roots = ref<Root[]>([]);

const selectedRootId = ref<string | null>(null);
const displayName = ref("");

const syncIntervalOptions = [
  { label: "Manual only", value: "manual" },
  { label: "Every hour", value: "1h" },
  { label: "Every day", value: "1d" },
];
const syncIntervalValue = ref<string>("manual");

const submitting = ref(false);
const submitError = ref<string | null>(null);

const canSubmit = computed(
  () => !!selectedRootId.value && displayName.value.trim().length > 0 && !submitting.value,
);

const intervalMs = computed(() => {
  switch (syncIntervalValue.value) {
    case "15m":
      return 15 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "1d":
      return 24 * 60 * 60 * 1000;
    default:
      return undefined;
  }
});

onMounted(async () => {
  try {
    const data = await Hay.documentSources.listRoots.query({
      pluginId: props.plugin.pluginId,
      instanceId: props.instanceId,
    });
    roots.value = (data?.roots ?? []) as Root[];
  } catch (err) {
    rootsError.value = err instanceof Error ? err.message : "Failed to load roots";
  } finally {
    loadingRoots.value = false;
  }
});

const selectRoot = (root: Root) => {
  selectedRootId.value = root.id;
  // Auto-fill displayName the first time, but don't clobber user edits.
  if (!displayName.value.trim()) {
    displayName.value = root.label;
  }
};

// If displayName is empty and a root is selected, sync the label.
watch(selectedRootId, (id) => {
  if (!id) return;
  const root = roots.value.find((r) => r.id === id);
  if (root && !displayName.value.trim()) {
    displayName.value = root.label;
  }
});

const handleSubmit = async () => {
  if (!selectedRootId.value) return;
  const selectedRoot = roots.value.find((r) => r.id === selectedRootId.value);
  if (!selectedRoot) return;

  submitError.value = null;
  submitting.value = true;

  try {
    const created = await Hay.documentSources.create.mutate({
      pluginId: props.plugin.pluginId,
      pluginInstanceId: props.instanceId,
      displayName: displayName.value.trim(),
      sourceType: props.plugin.pluginId,
      externalRootId: selectedRoot.id,
      externalRootLabel: selectedRoot.label,
      syncIntervalMs: intervalMs.value,
    });

    // Kick off the initial sync; failures here are non-blocking — the source
    // exists and the user can retry from its detail page.
    try {
      await Hay.documentSources.syncNow.mutate({ id: created.id });
    } catch (syncErr) {
      console.warn("Initial syncNow failed:", syncErr);
      toast.warning(
        "Source created, but initial sync could not be started",
        syncErr instanceof Error ? syncErr.message : undefined,
      );
    }

    toast.success(`Connected ${selectedRoot.label}`);
    emit("sourceCreated", { sourceId: created.id });
  } catch (err) {
    submitError.value = err instanceof Error ? err.message : "Failed to create source";
  } finally {
    submitting.value = false;
  }
};
</script>
