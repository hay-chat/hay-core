import { ref } from "vue";
import { useWebSocket } from "@/composables/useWebSocket";
import { useAppStore } from "@/stores/app";
import {
  PLUGIN_INSTALL_PROGRESS_EVENT,
  applyConnectEvent,
  completeConnectSteps,
  failConnectSteps,
  initialConnectSteps,
  isPluginInstallProgressEvent,
  type PluginConnectStepState,
} from "@/utils/plugin-connect-steps";

/** Connects quicker than this keep the plain button spinner; no dialog flashes by. */
const OPEN_DELAY_MS = 800;
/** Once ready, the dialog continues by itself after this long. */
export const PLUGIN_CONNECT_COUNTDOWN_MS = 5000;
const TICK_MS = 100;

export type PluginConnectPhase = "running" | "done" | "failed";

export interface PluginConnectTarget {
  pluginId: string;
  pluginName: string;
  configuration?: Record<string, unknown>;
  /** Footer button once ready; defaults to "Continue to setup". */
  continueLabel?: string;
}

// One connect at a time, shown by the single <PluginConnectProgress> in the default layout.
const open = ref(false);
const phase = ref<PluginConnectPhase>("running");
const steps = ref<PluginConnectStepState[]>(initialConnectSteps());
const target = ref<PluginConnectTarget | null>(null);
const errorMessage = ref<string | null>(null);
const now = ref(Date.now());
const countdownRemaining = ref(PLUGIN_CONNECT_COUNTDOWN_MS);
const countdownPaused = ref(false);

let progressId: string | null = null;
let settle: { resolve: (proceed: boolean) => void; reject: (error: unknown) => void } | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let openTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let lastTick = 0;

function tick() {
  const current = Date.now();
  const elapsed = current - lastTick;
  lastTick = current;
  now.value = current;
  if (phase.value !== "done" || !open.value || countdownPaused.value) return;
  countdownRemaining.value = Math.max(0, countdownRemaining.value - elapsed);
  if (countdownRemaining.value === 0) finish(true);
}

function cleanup() {
  if (ticker) clearInterval(ticker);
  if (openTimer) clearTimeout(openTimer);
  unsubscribe?.();
  ticker = null;
  openTimer = null;
  unsubscribe = null;
  progressId = null;
  settle = null;
}

function finish(proceed: boolean) {
  const pending = settle;
  open.value = false;
  cleanup();
  pending?.resolve(proceed);
}

function describeError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : null;
  return message ? message.replace(/hay-plugin-/g, "") : null;
}

export function usePluginConnect() {
  const appStore = useAppStore();
  const websocket = useWebSocket();

  async function attempt() {
    if (!target.value) return;
    const id = crypto.randomUUID();
    progressId = id;
    steps.value = initialConnectSteps();
    phase.value = "running";
    errorMessage.value = null;

    try {
      await appStore.enablePlugin(target.value.pluginId, target.value.configuration, id);
      if (progressId !== id) return;
      steps.value = completeConnectSteps(steps.value, Date.now());
      if (!open.value) return finish(true);
      phase.value = "done";
      countdownRemaining.value = PLUGIN_CONNECT_COUNTDOWN_MS;
      countdownPaused.value = false;
    } catch (error) {
      if (progressId !== id) return;
      if (!open.value) {
        // Never shown (fast failure) or hidden by the user: the caller reports it.
        const pending = settle;
        cleanup();
        pending?.reject(error);
        return;
      }
      steps.value = failConnectSteps(steps.value, Date.now());
      phase.value = "failed";
      errorMessage.value = describeError(error);
    } finally {
      if (openTimer) clearTimeout(openTimer);
      openTimer = null;
    }
  }

  /**
   * Enables the plugin, showing step-by-step progress when it takes a while.
   * Resolves `true` when the caller should go on (to setup, OAuth, ...),
   * `false` when the user closed the dialog after a failure it already showed.
   * Rejects when it failed without the dialog on screen, so the caller can toast.
   */
  function connect(next: PluginConnectTarget): Promise<boolean> {
    if (settle) return Promise.reject(new Error("Another plugin is still connecting"));

    target.value = next;
    open.value = false;
    unsubscribe = websocket.on(PLUGIN_INSTALL_PROGRESS_EVENT, (payload) => {
      if (!isPluginInstallProgressEvent(payload) || payload.progressId !== progressId) return;
      if (phase.value !== "running") return;
      steps.value = applyConnectEvent(steps.value, payload.step, payload.status, Date.now());
    });
    lastTick = Date.now();
    now.value = lastTick;
    ticker = setInterval(tick, TICK_MS);
    openTimer = setTimeout(() => {
      if (phase.value === "running") open.value = true;
    }, OPEN_DELAY_MS);

    return new Promise<boolean>((resolve, reject) => {
      settle = { resolve, reject };
      void attempt();
    });
  }

  /** Escape, backdrop or Close. While running it only hides; the connect carries on. */
  function dismiss() {
    if (phase.value === "running") open.value = false;
    else finish(phase.value === "done");
  }

  function continueNow() {
    if (phase.value === "done") finish(true);
  }

  function retry() {
    if (phase.value === "failed") void attempt();
  }

  function setCountdownPaused(paused: boolean) {
    countdownPaused.value = paused;
  }

  return {
    open,
    phase,
    steps,
    target,
    errorMessage,
    now,
    countdownRemaining,
    countdownPaused,
    connect,
    dismiss,
    continueNow,
    retry,
    setCountdownPaused,
  };
}
