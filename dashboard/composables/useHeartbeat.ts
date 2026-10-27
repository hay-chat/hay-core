import { ref, onMounted, onUnmounted } from "vue";
import { Hay } from "@/utils/api";

const HEARTBEAT_INTERVAL = 30_000;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let visibilityChangeHandler: (() => void) | null = null;
// True between startHeartbeat() and stopHeartbeat() (the signed-in session),
// whether or not the tab is visible. Hiding the tab only pauses the interval.
const isActive = ref(false);

const sendHeartbeat = async () => {
  try {
    await Hay.auth.heartbeat.mutate();
  } catch (error) {
    console.error("Heartbeat failed:", error);
  }
};

const resumeInterval = () => {
  if (heartbeatInterval) return;
  sendHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
};

const pauseInterval = () => {
  if (!heartbeatInterval) return;
  clearInterval(heartbeatInterval);
  heartbeatInterval = null;
};

export function useHeartbeat() {
  const route = useRoute();

  const startHeartbeat = () => {
    // Skip heartbeat on public pages
    if (route.meta.public === true) {
      return;
    }

    if (isActive.value) return;

    isActive.value = true;

    const hasDocument = typeof document !== "undefined";

    if (!hasDocument || !document.hidden) {
      resumeInterval();
    }

    // Pause while the tab is hidden and resume when it is shown again. The
    // listener lives for the whole session; only stopHeartbeat() removes it.
    if (hasDocument && !visibilityChangeHandler) {
      visibilityChangeHandler = () => {
        if (document.hidden) {
          pauseInterval();
        } else if (isActive.value) {
          resumeInterval();
        }
      };
      document.addEventListener("visibilitychange", visibilityChangeHandler);
    }
  };

  const stopHeartbeat = () => {
    if (!isActive.value) return;

    isActive.value = false;
    pauseInterval();

    if (visibilityChangeHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", visibilityChangeHandler);
      visibilityChangeHandler = null;
    }
  };

  onMounted(() => {
    startHeartbeat();
  });

  onUnmounted(() => {
    stopHeartbeat();
  });

  return {
    isActive,
    startHeartbeat,
    stopHeartbeat,
    sendHeartbeat,
  };
}
