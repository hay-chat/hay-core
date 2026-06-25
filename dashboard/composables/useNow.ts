import { ref, onUnmounted, type Ref } from "vue";

/**
 * Shared, reactive "current time" clock. A single interval is shared across all
 * consumers (same pattern as useToast/useOrgDateTime) and is torn down once the
 * last consumer unmounts. Used to keep relative timestamps ("3 minutes ago")
 * live without each component owning its own timer.
 */
const now = ref<Date>(new Date());

const DEFAULT_INTERVAL_MS = 30_000;

let intervalId: ReturnType<typeof setInterval> | null = null;
let consumers = 0;

export function useNow(): Ref<Date> {
  consumers++;

  if (!intervalId) {
    intervalId = setInterval(() => {
      now.value = new Date();
    }, DEFAULT_INTERVAL_MS);
  }

  onUnmounted(() => {
    consumers--;
    if (consumers <= 0 && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      consumers = 0;
    }
  });

  return now;
}
