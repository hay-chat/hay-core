import { ref, onBeforeUnmount } from "vue";
import type { Ref } from "vue";

export type AutoSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

interface UseAutoSaveOptions {
  /** Function to call when saving */
  saveFn: () => Promise<void>;
  /** Debounce delay in ms (default: 1500) */
  debounceMs?: number;
}

/**
 * Composable for auto-saving content with debounce, status tracking, and flush-on-unmount.
 */
export function useAutoSave(options: UseAutoSaveOptions) {
  const { saveFn, debounceMs = 1500 } = options;

  const status: Ref<AutoSaveStatus> = ref("idle");
  const lastSavedAt: Ref<Date | null> = ref(null);
  const error: Ref<string | null> = ref(null);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSave = false;

  const executeSave = async () => {
    if (status.value === "saving") {
      pendingSave = true;
      return;
    }

    status.value = "saving";
    error.value = null;

    try {
      await saveFn();
      status.value = "saved";
      lastSavedAt.value = new Date();

      // If another save was requested while we were saving, do it now
      if (pendingSave) {
        pendingSave = false;
        await executeSave();
      }
    } catch (e) {
      status.value = "error";
      error.value = e instanceof Error ? e.message : "Save failed";
    }
  };

  /** Schedule a debounced save. Call this on every content change. */
  const triggerSave = () => {
    // Show "unsaved changes" immediately while waiting for debounce
    if (status.value !== "saving") {
      status.value = "pending";
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      executeSave();
    }, debounceMs);
  };

  /** Immediately flush any pending debounced save. */
  const flush = async () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      await executeSave();
    }
  };

  /** Retry the last failed save. */
  const retry = () => {
    executeSave();
  };

  // Flush on unmount so we don't lose the last edit
  onBeforeUnmount(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      // Fire-and-forget: we can't await in onBeforeUnmount
      executeSave();
    }
  });

  return {
    status,
    lastSavedAt,
    error,
    triggerSave,
    flush,
    retry,
  };
}
