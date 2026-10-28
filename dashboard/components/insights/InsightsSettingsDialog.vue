<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ $t("insights.page.settingsDialog.title") }}</DialogTitle>
        <DialogDescription>{{ $t("insights.page.settingsDialog.description") }}</DialogDescription>
      </DialogHeader>

      <div v-if="loading" class="py-6 text-center"><Loading /></div>
      <div v-else class="space-y-4">
        <Input
          v-model="form.minClusterSize"
          type="number"
          :label="$t('insights.page.settingsDialog.minClusterSize')"
        />
        <div class="flex items-center space-x-2">
          <Switch id="insights-digest" v-model="form.digestEnabled" />
          <Label for="insights-digest">{{
            $t("insights.page.settingsDialog.digestEnabled")
          }}</Label>
        </div>

        <details class="text-sm">
          <summary class="cursor-pointer text-neutral-muted">
            {{ $t("insights.page.settingsDialog.advanced") }}
          </summary>
          <div class="grid gap-4 md:grid-cols-2 mt-3">
            <Input
              v-model="form.joinThreshold"
              type="number"
              :label="$t('insights.page.settingsDialog.joinThreshold')"
            />
            <Input
              v-model="form.mergeThreshold"
              type="number"
              :label="$t('insights.page.settingsDialog.mergeThreshold')"
            />
          </div>
        </details>

        <p v-if="tuning" class="text-xs text-neutral-muted">
          {{ $t("insights.page.settingsDialog.tuning", tuning) }}
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">
          {{ $t("common.cancel") }}
        </Button>
        <Button :loading="saving" :disabled="loading" @click="save">
          {{ $t("insights.page.settingsDialog.save") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { HayApi } from "@/utils/api";
import type { RouterOutputs } from "@/types/trpc";

type Tuning = RouterOutputs["insights"]["getSettings"]["tuning"];

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean]; saved: [] }>();

const { t } = useI18n();
const toast = useToast();

const loading = ref(false);
const saving = ref(false);
const tuning = ref<Tuning | null>(null);
const form = ref({
  minClusterSize: "5",
  joinThreshold: "0.86",
  mergeThreshold: "0.91",
  digestEnabled: true,
});

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    loading.value = true;
    try {
      const settings = await HayApi.insights.getSettings.query();
      form.value = {
        minClusterSize: String(settings.thresholds.minClusterSize),
        joinThreshold: String(settings.thresholds.joinThreshold),
        mergeThreshold: String(settings.thresholds.mergeThreshold),
        digestEnabled: settings.thresholds.digestEnabled,
      };
      tuning.value = settings.tuning;
    } catch (error) {
      console.error("Failed to load insights settings:", error);
    } finally {
      loading.value = false;
    }
  },
);

const numberOrUndefined = (value: string) => {
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) && String(value).trim() !== "" ? parsed : undefined;
};

const save = async () => {
  saving.value = true;
  try {
    const minClusterSize = numberOrUndefined(form.value.minClusterSize);
    await HayApi.insights.updateSettings.mutate({
      minClusterSize: minClusterSize !== undefined ? Math.round(minClusterSize) : undefined,
      joinThreshold: numberOrUndefined(form.value.joinThreshold),
      mergeThreshold: numberOrUndefined(form.value.mergeThreshold),
      digestEnabled: form.value.digestEnabled,
    });
    toast.success(t("insights.page.settingsDialog.saved"));
    emit("saved");
    emit("update:open", false);
  } catch (error) {
    console.error("Failed to save insights settings:", error);
    toast.error(t("insights.page.settingsDialog.error"));
  } finally {
    saving.value = false;
  }
};
</script>
