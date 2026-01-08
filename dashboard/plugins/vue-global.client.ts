/**
 * Expose Vue as a global variable for plugin UMD bundles
 *
 * Plugin UMD bundles built with Vite expect Vue to be available as window.Vue.
 * This plugin ensures Vue is available globally before any plugin components load.
 */
import * as Vue from 'vue';

export default defineNuxtPlugin(() => {
  // Expose Vue globally for UMD bundles
  if (typeof window !== 'undefined') {
    (window as any).Vue = Vue;
    console.log('[VueGlobal] Vue exposed globally for plugin UMD bundles');
  }
});
