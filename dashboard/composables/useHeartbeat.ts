import { ref, onMounted, onUnmounted } from "vue";
import { Hay } from "@/utils/api";

const HEARTBEAT_INTERVAL = 10_000; // 10 seconds
let heartbeatInterval: NodeJS.Timeout | null = null;
let visibilityChangeHandler: (() => void) | null = null;
const isActive = ref(false);

export function useHeartbeat() {
  const sendHeartbeat = async () => {
    try {
      await Hay.auth.heartbeat.mutate();
    } catch (error) {
      console.error("Heartbeat failed:", error);
    }
  };

  const startHeartbeat = () => {
    if (isActive.value) return;

    isActive.value = true;

    // Send initial heartbeat immediately
    sendHeartbeat();

    // Set up interval for subsequent heartbeats
    heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    // Handle visibility change (pause when tab is hidden)
    if (typeof document !== "undefined") {
      visibilityChangeHandler = () => {
        if (document.hidden) {
          stopHeartbeat();
        } else {
          startHeartbeat();
        }
      };
      document.addEventListener("visibilitychange", visibilityChangeHandler);
    }
  };

  const stopHeartbeat = () => {
    if (!isActive.value) return;

    isActive.value = false;

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

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
