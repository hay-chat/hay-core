<template>
  <div class="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("helpCenter.appearance.title") }}</CardTitle>
        <CardDescription>{{ $t("helpCenter.appearance.description") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-5">
        <HelpCenterThemeFields
          :model-value="modelValue"
          extended
          @update:model-value="emit('update:modelValue', $event)"
        />
        <div class="flex justify-end gap-2">
          <Button variant="outline" :disabled="!dirty || saving" @click="emit('reset')">
            {{ $t("helpCenter.reset") }}
          </Button>
          <Button :loading="saving" :disabled="!dirty" data-testid="save-theme" @click="save">
            {{ $t("helpCenter.saveChanges") }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card class="lg:sticky lg:top-4">
      <CardHeader>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{{ $t("helpCenter.appearance.previewTitle") }}</CardTitle>
          <div
            role="group"
            :aria-label="$t('helpCenter.appearance.previewWidth')"
            class="flex gap-1"
          >
            <Button
              v-for="option in widths"
              :key="option.id"
              size="sm"
              :variant="width === option.id ? 'secondary' : 'ghost'"
              :aria-pressed="width === option.id"
              @click="width = option.id"
            >
              <component :is="option.icon" class="mr-1 h-4 w-4" />
              {{ $t(`helpCenter.appearance.${option.id}`) }}
            </Button>
          </div>
        </div>
        <CardDescription>
          {{
            dirty
              ? $t("helpCenter.appearance.previewUnsaved")
              : $t("helpCenter.appearance.previewSaved")
          }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex justify-center rounded-lg bg-neutral-100 p-2">
          <iframe
            v-if="previewSrc"
            :src="previewSrc"
            :title="$t('helpCenter.appearance.previewFrameTitle')"
            class="h-[36rem] w-full rounded-md border bg-white"
            :class="{ 'max-w-[390px]': width === 'mobile' }"
            sandbox="allow-scripts allow-same-origin allow-forms"
            referrerpolicy="no-referrer"
            data-testid="preview-frame"
          />
          <div
            v-else
            class="flex h-64 w-full items-center justify-center rounded-md border border-dashed bg-background p-6 text-center text-sm text-neutral-muted"
            data-testid="preview-placeholder"
          >
            {{ $t("helpCenter.appearance.previewUnavailable") }}
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { refDebounced } from "@vueuse/core";
import { Monitor, Smartphone } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import {
  errorMessage,
  normalizeTheme,
  previewUrl,
  type HelpCenterPreviewLink,
  type HelpCenterTheme,
  type HelpCenterView,
} from "@/utils/help-center";
import HelpCenterThemeFields from "./HelpCenterThemeFields.vue";

const props = defineProps<{
  /** The theme being edited. The page owns it, so it survives switching tabs. */
  modelValue: HelpCenterTheme;
  dirty: boolean;
  previewLink: HelpCenterPreviewLink | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [theme: HelpCenterTheme];
  reset: [];
  updated: [helpCenter: HelpCenterView];
}>();

const { t } = useI18n();
const toast = useToast();

const widths = [
  { id: "desktop", icon: Monitor },
  { id: "mobile", icon: Smartphone },
] as const;
const width = ref<(typeof widths)[number]["id"]>("desktop");

// The frame reloads on every change of src, so wait for a pause in the editing.
const draftSrc = computed(() =>
  props.previewLink ? previewUrl(props.previewLink, normalizeTheme(props.modelValue)) : "",
);
const previewSrc = refDebounced(draftSrc, 400);

const saving = ref(false);

async function save() {
  saving.value = true;
  try {
    emit(
      "updated",
      await Hay.helpCenter.update.mutate({ theme: normalizeTheme(props.modelValue) }),
    );
    toast.success(t("helpCenter.saved"));
  } catch (error) {
    console.error("Failed to save the help center theme:", error);
    toast.error(t("helpCenter.saveFailed"), errorMessage(error));
  } finally {
    saving.value = false;
  }
}
</script>
