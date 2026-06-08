import { ref } from "vue";

export type ServerStatus = "online" | "offline" | "recovered";

const POLL_ONLINE = 15_000;
const POLL_OFFLINE = 4_000;
const REQUEST_TIMEOUT = 5_000;

// Module-level singleton state (shared across all callers), same pattern as useHeartbeat.
const status = ref<ServerStatus>("online");

let healthUrl: string | null = null;
let timeoutHandle: NodeJS.Timeout | null = null;
let visibilityHandler: (() => void) | null = null;
let started = false;
let inFlight = false;

/**
 * Hit the health endpoint once and update `status`.
 * - ok response  -> "online", or "recovered" if we were previously down
 * - failure      -> "offline"
 */
async function checkHealth(): Promise<void> {
  if (!healthUrl || inFlight) return;

  inFlight = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(healthUrl, { signal: controller.signal, cache: "no-store" });
    if (res.ok) {
      // A successful check after an outage surfaces the "back online" banner.
      // We stay in "recovered" until the user reloads, even if checks keep passing.
      if (status.value === "offline") {
        status.value = "recovered";
      } else if (status.value === "online") {
        status.value = "online";
      }
    } else {
      status.value = "offline";
    }
  } catch {
    // Network failure / timeout / abort => treat as unreachable.
    status.value = "offline";
  } finally {
    clearTimeout(timeout);
    inFlight = false;
  }
}

/** Run a check now and schedule the next one at a cadence based on current status. */
function tick(): void {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }

  void checkHealth().finally(() => {
    if (!started) return;
    const delay = status.value === "offline" ? POLL_OFFLINE : POLL_ONLINE;
    timeoutHandle = setTimeout(tick, delay);
  });
}

function pause(): void {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
}

function startMonitoring(): void {
  if (started || typeof window === "undefined") return;

  const config = useRuntimeConfig();
  healthUrl = `${config.public.apiBaseUrl}/v1/health`;
  started = true;

  // Mirror useHeartbeat: pause polling while the tab is hidden, re-check on return.
  visibilityHandler = () => {
    if (document.hidden) {
      pause();
    } else {
      tick();
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);

  if (!document.hidden) tick();
}

function stopMonitoring(): void {
  started = false;
  pause();
  if (visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

function reload(): void {
  if (typeof window !== "undefined") window.location.reload();
}

/**
 * Called by the tRPC error link on a network-level / 5xx failure to detect an outage
 * without waiting for the next poll. The health check itself is the confirmation, so a
 * single transient error won't flip the banner on its own.
 */
export function reportServerError(): void {
  if (!started || status.value === "offline" || typeof document === "undefined") return;
  if (document.hidden) return;
  tick();
}

export function useServerStatus() {
  return {
    status,
    checkHealth,
    reload,
    startMonitoring,
    stopMonitoring,
  };
}
