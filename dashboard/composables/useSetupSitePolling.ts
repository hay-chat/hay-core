import { onBeforeUnmount, watch } from "vue";
import { Hay } from "@/utils/api";
import { useSetupStore } from "@/stores/setup";

const POLL_MS = 3000;

/**
 * Re-reads the board every few seconds while the website is still being read, and
 * calls `onDone` once when reading finishes. Timers stop when the owner unmounts.
 */
export function useSetupSitePolling(onDone: () => void) {
  const store = useSetupStore();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

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
      if (!stopped && store.board?.site.state === "reading") schedule();
    }, POLL_MS);
  };

  watch(
    () => store.board?.site.state,
    (state, previous) => {
      if (state === "reading") {
        if (!timer) schedule();
        return;
      }
      clear();
      if (previous === "reading" && state === "done") onDone();
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    stopped = true;
    clear();
  });
}
