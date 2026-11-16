<template>
  <div class="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("helpCenter.appearance.title") }}</CardTitle>
        <CardDescription>{{ $t("helpCenter.appearance.description") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-5">
        <HelpCenterThemeFields
          :model-value="modelValue"
          :site-name="helpCenter.name"
          :brand-colors="brandColors"
          extended
          @update:model-value="emit('update:modelValue', $event)"
        >
          <template #hero-image>
            <div class="space-y-2">
              <Label for="hc-hero-image">{{ $t("helpCenter.theme.heroImage") }}</Label>
              <div class="flex flex-wrap items-center gap-3">
                <img
                  v-if="helpCenter.heroImageUrl"
                  :src="helpCenter.heroImageUrl"
                  :alt="$t('helpCenter.theme.heroImageAlt')"
                  class="h-12 w-20 rounded-md border object-cover"
                  data-testid="hero-image-thumbnail"
                />
                <input
                  id="hc-hero-image"
                  ref="imageInput"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  class="sr-only"
                  @change="onImagePicked"
                />
                <Button
                  variant="outline"
                  size="sm"
                  :loading="imageBusy"
                  data-testid="hero-image-upload"
                  @click="imageInput?.click()"
                >
                  {{
                    helpCenter.heroImageUrl
                      ? $t("helpCenter.theme.heroImageReplace")
                      : $t("helpCenter.theme.heroImageUpload")
                  }}
                </Button>
                <Button
                  v-if="helpCenter.heroImageUrl"
                  variant="link"
                  size="sm"
                  :disabled="imageBusy"
                  @click="removeImage"
                >
                  {{ $t("helpCenter.theme.heroImageRemove") }}
                </Button>
              </div>
              <p class="text-xs text-neutral-muted">{{ $t("helpCenter.theme.heroImageHint") }}</p>
              <p v-if="!helpCenter.heroImageUrl" class="text-xs text-amber-700" role="note">
                {{ $t("helpCenter.theme.heroImageMissing") }}
              </p>
            </div>
          </template>
        </HelpCenterThemeFields>
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
              :key="option"
              size="sm"
              :variant="width === option ? 'secondary' : 'ghost'"
              :aria-pressed="width === option"
              @click="width = option"
            >
              <component :is="option === 'desktop' ? Monitor : Smartphone" class="mr-1 h-4 w-4" />
              {{ $t(`helpCenter.appearance.${option}`) }}
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
        <div ref="stage" class="rounded-lg bg-neutral-100 p-3">
          <div
            v-if="previewSrc"
            class="mx-auto overflow-hidden bg-white shadow-sm"
            :class="
              width === 'mobile'
                ? 'rounded-[1.5rem] border-[6px] border-neutral-800'
                : 'rounded-md border'
            "
            :style="{ width: `${frameWidth}px` }"
            data-testid="preview-viewport"
          >
            <div
              v-if="width === 'desktop'"
              class="flex items-center gap-1.5 border-b bg-neutral-50 px-2 py-1.5"
              aria-hidden="true"
            >
              <span v-for="dot in 3" :key="dot" class="h-2 w-2 rounded-full bg-neutral-300" />
              <span
                class="ml-2 min-w-0 flex-1 truncate rounded bg-white px-2 py-0.5 text-[10px] text-neutral-muted"
              >
                {{ siteHost }}
              </span>
            </div>
            <div
              class="relative overflow-hidden"
              :style="{ height: `${viewport.height * scale}px` }"
            >
              <iframe
                :key="reloadKey"
                :src="previewSrc"
                :title="$t('helpCenter.appearance.previewFrameTitle')"
                class="absolute left-0 top-0 origin-top-left border-0 bg-white"
                :style="{
                  width: `${viewport.width}px`,
                  height: `${viewport.height}px`,
                  transform: `scale(${scale})`,
                }"
                sandbox="allow-scripts allow-same-origin allow-forms"
                referrerpolicy="no-referrer"
                data-testid="preview-frame"
              />
            </div>
          </div>
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
import { refDebounced, useResizeObserver } from "@vueuse/core";
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
  helpCenter: HelpCenterView;
  /** Colours imported from the organization's website. */
  brandColors?: string[];
}>();

const emit = defineEmits<{
  "update:modelValue": [theme: HelpCenterTheme];
  reset: [];
  /** The theme was saved: the draft is now the saved theme. */
  updated: [helpCenter: HelpCenterView];
  /** Something other than the theme was saved (the hero image): keep the draft. */
  changed: [helpCenter: HelpCenterView];
}>();

const { t } = useI18n();
const toast = useToast();

// The site is laid out at a real device width and shrunk to fit the card, so the preview
// shows the whole page as visitors see it rather than a cramped full-size page.
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;
/** Tallest the shrunk page may be, so a phone fits on screen beside the settings. */
const MAX_PREVIEW_HEIGHT = 600;
/** The phone frame's border on both sides. */
const FRAME_BORDER = 12;

const widths = ["desktop", "mobile"] as const;
const width = ref<(typeof widths)[number]>("desktop");
const viewport = computed(() => VIEWPORTS[width.value]);

const stage = ref<HTMLElement | null>(null);
const stageWidth = ref(0);
useResizeObserver(stage, (entries) => {
  stageWidth.value = entries[0]?.contentRect.width ?? 0;
});
const scale = computed(() => {
  // Before the first measurement, a typical card width.
  const available = (stageWidth.value || 560) - FRAME_BORDER;
  return Math.min(1, available / viewport.value.width, MAX_PREVIEW_HEIGHT / viewport.value.height);
});
const frameWidth = computed(
  () =>
    Math.round(viewport.value.width * scale.value) + (width.value === "mobile" ? FRAME_BORDER : 2),
);

const siteHost = computed(() => {
  try {
    return new URL(props.helpCenter.url).host;
  } catch {
    return props.helpCenter.url;
  }
});

// The frame reloads on every change of src, so wait for a pause in the editing.
const draftSrc = computed(() =>
  props.previewLink ? previewUrl(props.previewLink, normalizeTheme(props.modelValue)) : "",
);
const previewSrc = refDebounced(draftSrc, 400);
/** Bumped to reload the frame when something it shows changed on the server. */
const reloadKey = ref(0);

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

// --- Hero image: saved as soon as it is uploaded or removed, like the logo ---
const imageInput = ref<HTMLInputElement | null>(null);
const imageBusy = ref(false);
/** The server's limit (HERO_IMAGE_MAX_BYTES); checked here to fail fast. */
const HERO_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

async function changeImage(run: () => Promise<HelpCenterView>) {
  imageBusy.value = true;
  try {
    emit("changed", await run());
    reloadKey.value++;
    toast.success(t("helpCenter.saved"));
  } catch (error) {
    console.error("Failed to change the help center hero image:", error);
    toast.error(t("helpCenter.saveFailed"), errorMessage(error));
  } finally {
    imageBusy.value = false;
  }
}

function onImagePicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > HERO_IMAGE_MAX_BYTES) {
    toast.error(t("helpCenter.theme.heroImageTooLarge"));
    return;
  }
  void changeImage(async () =>
    Hay.helpCenter.uploadHeroImage.mutate({ image: await readAsDataUrl(file) }),
  );
}

function removeImage() {
  void changeImage(() => Hay.helpCenter.removeHeroImage.mutate());
}
</script>
