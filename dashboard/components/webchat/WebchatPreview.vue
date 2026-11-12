<template>
  <aside
    class="h-fit rounded-xl border bg-white lg:sticky lg:top-6"
    :aria-label="$t('webchat.preview.title')"
    data-testid="webchat-preview"
  >
    <div class="flex items-center justify-between gap-2 border-b px-4 py-3">
      <h2 class="text-base">{{ $t("webchat.preview.title") }}</h2>
      <div class="flex gap-1 text-xs" role="group" :aria-label="$t('webchat.preview.stateLabel')">
        <button
          v-for="option in states"
          :key="option"
          type="button"
          :aria-pressed="previewState === option"
          :class="segment(previewState === option)"
          @click="previewState = option"
        >
          {{ $t(`webchat.preview.states.${option}`) }}
        </button>
      </div>
    </div>
    <div class="flex flex-col items-center gap-3 bg-neutral-50 p-4">
      <div ref="stage" class="flex w-full justify-center">
        <div
          class="overflow-hidden rounded-lg border bg-white"
          :style="{ width: `${viewport.width * scale}px`, height: `${viewport.height * scale}px` }"
        >
          <iframe
            :srcdoc="srcdoc"
            sandbox="allow-scripts"
            :title="$t('webchat.preview.frameTitle')"
            tabindex="-1"
            class="origin-top-left border-0"
            :style="{
              width: `${viewport.width}px`,
              height: `${viewport.height}px`,
              transform: `scale(${scale})`,
            }"
            data-testid="webchat-preview-frame"
          />
        </div>
      </div>
      <div class="flex gap-1 text-xs">
        <div class="flex gap-1" role="group" :aria-label="$t('webchat.preview.deviceLabel')">
          <button
            v-for="option in devices"
            :key="option"
            type="button"
            :aria-pressed="device === option"
            :class="segment(device === option)"
            @click="device = option"
          >
            {{ $t(`webchat.preview.devices.${option}`) }}
          </button>
        </div>
        <span class="mx-1 w-px bg-neutral-200" aria-hidden="true" />
        <div class="flex gap-1" role="group" :aria-label="$t('webchat.preview.themeLabel')">
          <button
            v-for="option in themes"
            :key="option"
            type="button"
            :aria-pressed="theme === option"
            :class="segment(theme === option)"
            @click="theme = option"
          >
            {{ $t(`webchat.preview.themes.${option}`) }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useElementSize, watchDebounced } from "@vueuse/core";
import { useDomain } from "@/composables/useDomain";
import { useWebchatSettings } from "@/composables/useWebchatSettings";
import { useUserStore } from "@/stores/user";
import { buildPreviewSrcdoc, type WebchatPreviewConfig } from "@/utils/webchat-settings";

type PreviewState = WebchatPreviewConfig["preview"]["state"];
type PreviewDevice = WebchatPreviewConfig["preview"]["device"];

const states: PreviewState[] = ["home", "chat", "ended"];
const devices: PreviewDevice[] = ["desktop", "mobile"];
const themes = ["light", "dark"] as const;

// The widget renders at real size and the frame is scaled down to fit the panel.
const VIEWPORTS: Record<PreviewDevice, { width: number; height: number }> = {
  desktop: { width: 440, height: 780 },
  mobile: { width: 390, height: 844 },
};
const MAX_HEIGHT = 600;

const state = useWebchatSettings();
const form = state.form;
const userStore = useUserStore();
const { getApiUrl } = useDomain();

const previewState = ref<PreviewState>("home");
const device = ref<PreviewDevice>("desktop");
// Follows the saved choice; "Match the visitor" previews in light until switched here.
const theme = ref<(typeof themes)[number]>(form.value.themeMode === "dark" ? "dark" : "light");
watch(
  () => form.value.themeMode,
  (mode) => {
    if (mode !== "system") theme.value = mode;
  },
);

const stage = ref<HTMLElement | null>(null);
const { width: stageWidth } = useElementSize(stage);
const viewport = computed(() => VIEWPORTS[device.value]);
const scale = computed(() => {
  const fit = stageWidth.value ? stageWidth.value / viewport.value.width : 0.75;
  return Math.min(fit, MAX_HEIGHT / viewport.value.height, 1);
});

const config = computed<WebchatPreviewConfig>(() => ({
  organizationId: userStore.activeOrganizationId ?? "",
  baseUrl: getApiUrl(),
  position: form.value.position,
  brandColor: form.value.brandColor,
  themeMode: theme.value,
  logoUrl: state.logoSrc.value,
  homeHeading: form.value.homeHeading.trim() || null,
  widgetTitle: form.value.widgetTitle,
  greetingMessage: form.value.greetingMessage,
  showGreeting: form.value.showGreeting,
  csatEnabled: form.value.csatEnabled,
  csatQuestion: form.value.csatQuestion,
  teaserMessage: form.value.teaserMessage,
  preview: { state: previewState.value, device: device.value },
}));

const render = () =>
  buildPreviewSrcdoc(config.value, theme.value === "dark" ? "#0b0e13" : "#f1f3f6");
const srcdoc = ref(render());
// Typing re-renders the widget once the edits settle, not on every key.
watchDebounced(config, () => (srcdoc.value = render()), { debounce: 400, deep: true });

const segment = (on: boolean) =>
  on
    ? "rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700"
    : "rounded-md px-2 py-1 text-neutral-500 hover:text-neutral-700";
</script>
