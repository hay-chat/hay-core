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
          class="relative overflow-hidden rounded-lg border bg-white transition-[width,height] duration-300 ease-out motion-reduce:transition-none"
          :style="{ width: `${viewport.width * scale}px`, height: `${viewport.height * scale}px` }"
        >
          <!-- The next render loads under cover and fades in over the current one once the
               widget has painted, so an edit never shows a blank frame. -->
          <iframe
            v-for="frame in frames"
            :key="frame.key"
            :ref="(el) => setFrameEl(frame.key, el)"
            :srcdoc="frame.srcdoc"
            sandbox="allow-scripts"
            :title="$t('webchat.preview.frameTitle')"
            :aria-hidden="frame.shown ? undefined : 'true'"
            tabindex="-1"
            :class="[
              'absolute left-0 top-0 origin-top-left border-0 transition-opacity duration-200 ease-out motion-reduce:transition-none',
              frame.shown ? 'opacity-100' : 'pointer-events-none opacity-0',
            ]"
            :style="{
              width: `${viewport.width}px`,
              height: `${viewport.height}px`,
              transform: `scale(${scale})`,
            }"
            :data-testid="frame.shown ? 'webchat-preview-frame' : 'webchat-preview-frame-next'"
          />
          <Transition
            enter-active-class="transition-opacity duration-150"
            leave-active-class="transition-opacity duration-300"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
          >
            <div
              v-if="updating"
              class="webchat-preview-progress pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden"
              role="status"
              :aria-label="$t('webchat.preview.updating')"
              data-testid="webchat-preview-updating"
            >
              <span
                class="webchat-preview-progress__bar absolute inset-y-0 left-0 w-2/5 bg-primary"
              />
            </div>
          </Transition>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useElementSize, watchDebounced } from "@vueuse/core";
import { useDomain } from "@/composables/useDomain";
import { useWebchatSettings } from "@/composables/useWebchatSettings";
import { useUserStore } from "@/stores/user";
import { buildPreviewSrcdoc, type WebchatPreviewConfig } from "@/utils/webchat-settings";

type PreviewState = WebchatPreviewConfig["preview"]["state"];
type PreviewDevice = WebchatPreviewConfig["preview"]["device"];

// The visitor's journey: the button (and teaser), then the chat.
const states: PreviewState[] = ["closed", "home", "chat", "ended"];
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
  agentName: form.value.assistantName.trim() || null,
  agentAvatarUrl: state.assistantAvatarSrc.value,
  agentAvatarPreset: form.value.assistantAvatarPreset,
  launcherIcon: form.value.launcherIcon,
  launcherIconStyle: form.value.launcherIconStyle,
  launcherIconUrl: state.launcherIconSrc.value,
  preview: { state: previewState.value, device: device.value },
}));

const render = () =>
  buildPreviewSrcdoc(config.value, theme.value === "dark" ? "#0b0e13" : "#f1f3f6");

// --- Double-buffered frames: the shown one stays up while the next one loads.
// widget.js posts PREVIEW_READY once it has painted; the timeout covers a widget
// that never says so (it failed, or an older widget.js is cached).
const PREVIEW_READY = "hay-webchat:preview-ready";
const READY_TIMEOUT_MS = 4000;
const FADE_MS = 200;

interface Frame {
  key: number;
  srcdoc: string;
  shown: boolean;
}
let nextKey = 0;
const frames = ref<Frame[]>([{ key: nextKey++, srcdoc: render(), shown: true }]);
const frameEls = new Map<number, HTMLIFrameElement>();
const setFrameEl = (key: number, el: unknown) => {
  if (el instanceof HTMLIFrameElement) frameEls.set(key, el);
  else frameEls.delete(key);
};
const pending = computed(() => frames.value.find((frame) => !frame.shown) ?? null);
// From the first edit until its render is on screen (including the debounce while typing).
const editing = ref(false);
const updating = computed(() => editing.value || pending.value !== null);

let readyTimer: ReturnType<typeof setTimeout> | undefined;
let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

function showNext(srcdoc: string) {
  const latest = pending.value ?? frames.value[frames.value.length - 1];
  if (latest?.srcdoc === srcdoc) {
    editing.value = pending.value !== null;
    return;
  }
  // A newer render replaces one that is still loading; the shown frame stays.
  frames.value = [
    ...frames.value.filter((frame) => frame.shown),
    { key: nextKey++, srcdoc, shown: false },
  ];
  clearTimeout(readyTimer);
  readyTimer = setTimeout(promote, READY_TIMEOUT_MS);
}

function promote() {
  const next = pending.value;
  if (!next) return;
  clearTimeout(readyTimer);
  next.shown = true;
  editing.value = false;
  // Drop the old frame once the new one has faded in over it.
  clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(() => {
    frames.value = frames.value.filter((frame) => frame.key === next.key || !frame.shown);
  }, FADE_MS);
}

function onMessage(event: MessageEvent) {
  if ((event.data as { type?: unknown } | null)?.type !== PREVIEW_READY) return;
  const next = pending.value;
  if (next && event.source === frameEls.get(next.key)?.contentWindow) promote();
}

onMounted(() => window.addEventListener("message", onMessage));
onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  clearTimeout(readyTimer);
  clearTimeout(cleanupTimer);
});

// Typing re-renders the widget once the edits settle, not on every key.
watch(config, () => (editing.value = true), { deep: true });
watchDebounced(config, () => showNext(render()), { debounce: 400, deep: true });
// The preview's own controls are single clicks: show them straight away.
watch([previewState, device, theme], () => showNext(render()));

// Same weight on and off, so picking one never nudges its neighbours.
const segment = (on: boolean) => [
  "rounded-md px-2 py-1 font-medium transition-colors",
  on ? "bg-neutral-100 text-neutral-700" : "text-neutral-500 hover:text-neutral-700",
];
</script>

<style scoped>
/* An indeterminate bar across the top of the preview while it re-renders. */
.webchat-preview-progress__bar {
  animation: webchat-preview-progress 1s ease-in-out infinite;
}
@keyframes webchat-preview-progress {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .webchat-preview-progress__bar {
    width: 100%;
    animation: none;
    opacity: 0.5;
  }
}
</style>
