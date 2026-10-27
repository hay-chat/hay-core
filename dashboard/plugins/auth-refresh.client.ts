import { useAuthStore } from "@/stores/auth";
import { ensureFreshAccessToken } from "@/utils/api";

/**
 * Keep the access token fresh in the background, and catch up as soon as the
 * device is back: a PWA waking from the background or a phone regaining
 * signal refreshes right away instead of on the next request.
 * Failures are only logged: utils/api logs out on a rejected refresh alone.
 */
export default defineNuxtPlugin(() => {
  const authStore = useAuthStore();
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  const refreshIfExpiring = () => {
    if (!authStore.isAuthenticated) return;
    ensureFreshAccessToken(2 * 60_000).catch((error) => {
      console.warn("[Auth Refresh Plugin] Refresh deferred:", error);
    });
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") refreshIfExpiring();
  };

  const start = () => {
    stop();
    refreshInterval = setInterval(refreshIfExpiring, 30_000);
    window.addEventListener("online", refreshIfExpiring);
    document.addEventListener("visibilitychange", onVisibilityChange);
    refreshIfExpiring();
  };

  const stop = () => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
    window.removeEventListener("online", refreshIfExpiring);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };

  watch(
    () => authStore.isAuthenticated,
    (isAuthenticated) => (isAuthenticated ? start() : stop()),
    { immediate: true },
  );
});
