/**
 * Manual Pinia persistence plugin
 * The Nuxt module isn't working, so we install it manually
 */
import { createPersistedState } from 'pinia-plugin-persistedstate'
import type { Pinia } from 'pinia'

export default defineNuxtPlugin(({ $pinia }: { $pinia: Pinia }) => {
  if (!$pinia) {
    console.error('[Pinia Persistence] $pinia not found!')
    return
  }

  // Install the persistence plugin
  $pinia.use(createPersistedState({
    storage: window.localStorage,
    auto: true, // Auto-persist stores with persist: true
  }))
})
