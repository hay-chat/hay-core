import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import type { Ref } from "vue";
import { useRouter } from "vue-router";

/**
 * Composable to detect and warn about unsaved changes
 *
 * @param initialData - Reference to the initial/saved data
 * @param currentData - Reference to the current form data
 * @param enabled - Whether to enable the unsaved changes detection (default: true)
 * @returns Object with hasUnsavedChanges ref and confirmNavigation function
 */
export function useUnsavedChanges<T>(
  initialData: Ref<T>,
  currentData: Ref<T>,
  enabled: Ref<boolean> = ref(true)
) {
  const router = useRouter();
  const hasUnsavedChanges = ref(false);

  // Dialog state for custom confirmation
  const showConfirmDialog = ref(false);
  const confirmDialogConfig = ref({
    title: "Unsaved Changes",
    description: "You have unsaved changes. Are you sure you want to leave this page?",
    onConfirm: () => {},
  });

  // Deep compare function to check if data has changed
  const hasChanges = () => {
    if (!enabled.value) return false;
    return JSON.stringify(initialData.value) !== JSON.stringify(currentData.value);
  };

  // Watch for changes
  watch(
    [initialData, currentData, enabled],
    () => {
      hasUnsavedChanges.value = hasChanges();
    },
    { deep: true }
  );

  // Browser beforeunload event handler
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (hasUnsavedChanges.value) {
      e.preventDefault();
      // Modern browsers require returnValue to be set
      e.returnValue = "";
      return "";
    }
  };

  // Pending navigation/resolution callbacks
  let pendingNavigationCallback: (() => void) | null = null;
  let pendingResolve: ((value: boolean) => void) | null = null;

  // Handle dialog confirmation (shared between router and manual navigation)
  const handleConfirmLeave = () => {
    showConfirmDialog.value = false;
    hasUnsavedChanges.value = false; // Reset to prevent further prompts

    // Execute pending navigation (from router guard)
    if (pendingNavigationCallback) {
      pendingNavigationCallback();
      pendingNavigationCallback = null;
    }

    // Resolve pending promise (from manual confirmNavigation call)
    if (pendingResolve) {
      pendingResolve(true);
      pendingResolve = null;
    }
  };

  // Set the onConfirm handler
  confirmDialogConfig.value.onConfirm = handleConfirmLeave;

  // Nuxt router beforeEach guard
  const unregisterRouterGuard = router.beforeEach((to, from, next) => {
    if (hasUnsavedChanges.value) {
      // Store the navigation callback with the destination
      pendingNavigationCallback = () => {
        // Temporarily disable change detection to allow navigation
        hasUnsavedChanges.value = false;
        // Navigate to the intended destination
        router.push(to.fullPath);
      };

      // Show custom confirmation dialog
      showConfirmDialog.value = true;

      // Cancel navigation for now - will proceed if user confirms
      next(false);
    } else {
      next();
    }
  });

  // Register event listeners
  onMounted(() => {
    window.addEventListener("beforeunload", handleBeforeUnload);
  });

  // Cleanup
  onBeforeUnmount(() => {
    window.removeEventListener("beforeunload", handleBeforeUnload);
    unregisterRouterGuard();
  });

  /**
   * Programmatically show confirmation dialog for manual navigation (e.g., Cancel button)
   * Returns a promise that resolves with user's choice
   */
  const confirmNavigation = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (hasUnsavedChanges.value) {
        // Store the resolve function
        pendingResolve = resolve;

        // Show the dialog
        showConfirmDialog.value = true;
      } else {
        resolve(true);
      }
    });
  };

  /**
   * Mark changes as saved (resets the unsaved changes flag)
   */
  const markAsSaved = () => {
    hasUnsavedChanges.value = false;
    initialData.value = JSON.parse(JSON.stringify(currentData.value));
  };

  /**
   * Handle dialog cancellation
   */
  const handleDialogCancel = () => {
    showConfirmDialog.value = false;
    pendingNavigationCallback = null;

    // Resolve any pending promise with false
    if (pendingResolve) {
      pendingResolve(false);
      pendingResolve = null;
    }
  };

  return {
    hasUnsavedChanges,
    confirmNavigation,
    markAsSaved,
    showConfirmDialog,
    confirmDialogConfig,
    handleDialogCancel,
  };
}
