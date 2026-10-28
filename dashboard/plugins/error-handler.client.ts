import type { NuxtApp } from "nuxt/app";

/**
 * Log uncaught errors. Session expiry is not decided here: utils/api logs the
 * user out only when the server rejects the refresh token.
 */
export default defineNuxtPlugin((nuxtApp: NuxtApp) => {
  nuxtApp.vueApp.config.errorHandler = (error: unknown, _instance: unknown, info: string) => {
    console.error("[Global Error Handler]", error, info);
  };

  window.addEventListener("unhandledrejection", (event) => {
    console.error("[Unhandled Promise Rejection]", event.reason);
  });
});
