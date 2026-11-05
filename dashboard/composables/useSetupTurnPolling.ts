import { onBeforeUnmount, watch } from "vue";
import { Hay } from "@/utils/api";
import { useSetupStore } from "@/stores/setup";

const POLL_MS = 3000;
/** The server fails a lost test turn well before this; it only stops a poll that never settles. */
const GIVE_UP_MS = 10 * 60 * 1000;

/**
 * Re-reads the board every few seconds while `active()` holds, which the page sets while rows are
 * still being tested for real. Each read lets the server settle finished or lost test turns.
 * Timers stop when the owner unmounts.
 */
export function useSetupTurnPolling(active: () => boolean) {
  const store = useSetupStore();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let startedAt = 0;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clear();
    timer = setTimeout(async () => {
      timer = null;
      try {
        const board = await Hay.setup.get.query();
        if (stopped) return;
        store.apply(board);
      } catch {
        // A failed poll is retried on the next tick; the board keeps its last state.
      }
      if (!stopped && active() && Date.now() - startedAt < GIVE_UP_MS) schedule();
    }, POLL_MS);
  };

  watch(
    active,
    (isActive) => {
      if (!isActive) {
        clear();
        return;
      }
      if (!timer) {
        startedAt = Date.now();
        schedule();
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    stopped = true;
    clear();
  });
}
