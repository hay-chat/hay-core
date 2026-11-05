<template>
  <Dialog :open="open" size="sm" @update:open="onOpenChange">
    <div
      class="-m-6 text-left"
      data-testid="plugin-connect-progress"
      @mouseenter="setCountdownPaused(true)"
      @mouseleave="setCountdownPaused(false)"
    >
      <div class="flex items-center gap-3.5 px-6 pb-4 pt-6">
        <div
          class="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-neutral-200 bg-neutral-100"
        >
          <img
            v-if="target && !thumbnailFailed"
            :src="thumbnailUrl"
            alt=""
            class="h-7 w-7 object-contain"
            @error="thumbnailFailed = true"
          />
          <Plug v-else class="h-5 w-5 text-neutral-600" aria-hidden="true" />
        </div>
        <div class="flex min-w-0 flex-col gap-1.5">
          <HeadlessDialogTitle
            as="h2"
            class="text-[19px] font-medium leading-tight text-neutral-800"
          >
            {{ headline }}
          </HeadlessDialogTitle>
          <HeadlessDialogDescription class="text-[13px] leading-snug text-neutral-500">
            {{ subline }}
          </HeadlessDialogDescription>
        </div>
      </div>

      <ol class="flex flex-col px-6 pb-4 pt-1 tabular-nums" aria-live="polite">
        <li v-for="(step, index) in viewSteps" :key="step.key" class="relative flex gap-3.5 pb-3.5">
          <div
            v-if="index < viewSteps.length - 1"
            aria-hidden="true"
            class="absolute bottom-0.5 left-[13px] top-[30px] w-0.5 rounded-full transition-colors duration-500"
            :class="step.finished ? 'bg-green-200' : 'bg-neutral-200'"
          />

          <div class="relative h-7 w-7 shrink-0" aria-hidden="true">
            <div
              v-if="step.status === 'pending'"
              class="h-7 w-7 rounded-full border-[1.5px] border-neutral-300 bg-background"
            />
            <template v-else-if="step.status === 'active'">
              <svg class="absolute inset-0" width="28" height="28" viewBox="0 0 28 28">
                <circle
                  cx="14"
                  cy="14"
                  r="12"
                  class="fill-primary-50 stroke-primary-100"
                  stroke-width="2"
                />
              </svg>
              <svg class="connect-ring absolute inset-0" width="28" height="28" viewBox="0 0 28 28">
                <circle
                  cx="14"
                  cy="14"
                  r="12"
                  fill="none"
                  class="stroke-primary"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-dasharray="22 54"
                />
              </svg>
              <div class="connect-dot absolute left-2.5 top-2.5 h-2 w-2 rounded-full bg-primary" />
            </template>
            <div
              v-else-if="step.finished"
              class="connect-pop flex h-7 w-7 items-center justify-center rounded-full bg-green-50"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  class="connect-check stroke-green-700"
                  d="M3 7.4 5.8 10 11 4.2"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
            <div
              v-else
              class="connect-pop flex h-7 w-7 items-center justify-center rounded-full bg-red-50"
            >
              <X class="h-3.5 w-3.5 text-red-700" :stroke-width="2.5" />
            </div>
          </div>

          <div class="flex min-w-0 flex-1 flex-col gap-1 pt-1">
            <div class="flex items-baseline gap-2">
              <span
                class="text-sm font-medium leading-snug transition-colors"
                :class="{
                  'text-neutral-400': step.status === 'pending',
                  'text-red-800': step.status === 'failed',
                  'text-neutral-800': step.status !== 'pending' && step.status !== 'failed',
                }"
              >
                {{ $t(`pluginConnect.steps.${step.key}.label`) }}
              </span>
              <span
                v-if="step.meta"
                class="ml-auto whitespace-nowrap text-xs"
                :class="{
                  'text-green-700': step.finished,
                  'text-red-700': step.status === 'failed',
                  'text-neutral-500': step.status === 'active',
                }"
              >
                {{ step.meta }}
              </span>
            </div>

            <div v-if="step.status === 'active'" class="flex flex-col gap-2 pt-0.5">
              <span class="text-xs text-neutral-500">
                {{ $t(`pluginConnect.steps.${step.key}.detail`, { name: pluginName }) }}
              </span>
              <div class="relative h-1 overflow-hidden rounded-full bg-primary-50">
                <div class="connect-sweep absolute inset-y-0 w-2/5 rounded-full bg-primary-500" />
              </div>
            </div>

            <p
              v-if="step.status === 'failed'"
              class="mt-1 break-words rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-800"
            >
              {{ errorMessage || $t("pluginConnect.unknownError") }}
            </p>
          </div>
        </li>
      </ol>

      <div class="flex items-center gap-2.5 border-t border-neutral-100 bg-neutral-50 px-6 py-4">
        <template v-if="phase === 'running'">
          <span class="flex-1 text-xs text-neutral-500">{{ $t("pluginConnect.runningNote") }}</span>
          <!-- Focusable on purpose: the dialog needs one focus target while it runs. -->
          <Button aria-disabled="true" class="cursor-not-allowed opacity-45" @click.prevent>
            {{ continueLabel }}
          </Button>
        </template>

        <template v-else-if="phase === 'done'">
          <span class="flex-1 text-xs font-medium text-green-700">{{
            $t("pluginConnect.ready")
          }}</span>
          <Button
            class="relative overflow-hidden"
            data-testid="plugin-connect-continue"
            :aria-label="`${continueLabel}. ${$t('pluginConnect.countdown', { seconds: countdownSeconds })}`"
            @click="continueNow"
          >
            <span
              aria-hidden="true"
              class="absolute inset-y-0 left-0 bg-white/15 transition-[width] duration-100 ease-linear"
              :style="{ width: `${countdownProgress}%` }"
            />
            <span class="relative inline-flex items-center gap-2">
              {{ continueLabel }}
              <span
                aria-hidden="true"
                class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-xs tabular-nums"
              >
                {{ countdownSeconds }}
              </span>
            </span>
          </Button>
        </template>

        <template v-else>
          <span class="flex-1" />
          <Button variant="outline" @click="dismiss">{{ $t("pluginConnect.close") }}</Button>
          <Button data-testid="plugin-connect-retry" @click="retry">
            {{ $t("pluginConnect.tryAgain") }}
          </Button>
        </template>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  DialogTitle as HeadlessDialogTitle,
  DialogDescription as HeadlessDialogDescription,
} from "@headlessui/vue";
import { Plug, X } from "lucide-vue-next";
import { usePluginConnect, PLUGIN_CONNECT_COUNTDOWN_MS } from "@/composables/usePluginConnect";
import { useDomain } from "@/composables/useDomain";

const { t } = useI18n();
const { getApiUrl } = useDomain();
const {
  open,
  phase,
  steps,
  target,
  errorMessage,
  now,
  countdownRemaining,
  dismiss,
  continueNow,
  retry,
  setCountdownPaused,
} = usePluginConnect();

const thumbnailFailed = ref(false);
watch(
  () => target.value?.pluginId,
  () => (thumbnailFailed.value = false),
);

const pluginName = computed(() => target.value?.pluginName ?? "");
const thumbnailUrl = computed(() =>
  target.value ? getApiUrl(`/plugins/thumbnails/${encodeURIComponent(target.value.pluginId)}`) : "",
);
const continueLabel = computed(() => target.value?.continueLabel ?? t("pluginConnect.continue"));

const headline = computed(() => {
  const name = pluginName.value;
  if (phase.value === "done") return t("pluginConnect.readyTitle", { name });
  if (phase.value === "failed") return t("pluginConnect.failedTitle", { name });
  return t("pluginConnect.title", { name });
});
const subline = computed(() => {
  if (phase.value === "done") return t("pluginConnect.readySubtitle");
  if (phase.value === "failed") return t("pluginConnect.failedSubtitle");
  return t("pluginConnect.subtitle");
});

const formatSeconds = (ms: number) =>
  t("pluginConnect.seconds", { value: (Math.max(0, ms) / 1000).toFixed(1) });

const viewSteps = computed(() =>
  steps.value.map((step) => {
    const finished = step.status === "done" || step.status === "skipped";
    let meta = "";
    if (step.status === "skipped") meta = t("pluginConnect.skipped");
    else if (step.status === "failed") meta = t("pluginConnect.failed");
    else if (step.status === "done" && step.startedAt && step.finishedAt)
      meta = formatSeconds(step.finishedAt - step.startedAt);
    else if (step.status === "active" && step.startedAt)
      meta = formatSeconds(now.value - step.startedAt);
    return { ...step, finished, meta };
  }),
);

const countdownSeconds = computed(() => Math.max(1, Math.ceil(countdownRemaining.value / 1000)));
const countdownProgress = computed(
  () => (1 - countdownRemaining.value / PLUGIN_CONNECT_COUNTDOWN_MS) * 100,
);

const onOpenChange = (value: boolean) => {
  if (!value) dismiss();
};
</script>

<style scoped>
@keyframes connect-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes connect-pop {
  0% {
    transform: scale(0.6);
    opacity: 0;
  }
  60% {
    transform: scale(1.08);
    opacity: 1;
  }
  100% {
    transform: scale(1);
  }
}
@keyframes connect-draw {
  from {
    stroke-dashoffset: 14;
  }
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes connect-sweep {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}
@keyframes connect-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
.connect-ring {
  transform-origin: 50% 50%;
  animation: connect-spin 0.9s linear infinite;
}
.connect-pop {
  animation: connect-pop 0.36s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.connect-check {
  stroke-dasharray: 14;
  animation: connect-draw 0.3s 0.1s ease-out both;
}
.connect-sweep {
  animation: connect-sweep 1.4s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
.connect-dot {
  animation: connect-pulse 1.2s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .connect-ring,
  .connect-sweep,
  .connect-dot {
    animation: none;
  }
  .connect-pop,
  .connect-check {
    animation-duration: 1ms;
  }
}
</style>
