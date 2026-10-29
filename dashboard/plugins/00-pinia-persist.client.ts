/**
 * Manual Pinia persistence plugin
 * The Nuxt module isn't working, so we install it manually
 */
import { logger } from "@/utils/logger";
import { createPersistedState } from "pinia-plugin-persistedstate";
import type { Pinia } from "pinia";

export default defineNuxtPlugin(({ $pinia }: { $pinia: Pinia }) => {
  if (!$pinia) {
    console.error("[Pinia Persistence] $pinia not found!");
    return;
  }

  logger.debug("[Pinia Persistence] Installing persistence plugin");

  // Install the persistence plugin
  $pinia.use(
    createPersistedState({
      storage: window.localStorage,
      // Only stores that opt in with `persist: { pick: [...] }` are written to localStorage.
      auto: false,
    }),
  );

  // The analytics cache is no longer persisted; drop what older builds stored.
  window.localStorage.removeItem("analytics");

  logger.debug("[Pinia Persistence] Plugin installed successfully");
});
