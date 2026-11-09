import type { NuxtApp } from "nuxt/app";
import type posthog from "posthog-js";
import { sanitizeError } from "@/utils/error-report";

/**
 * Log uncaught errors and, when PostHog is configured, report them without
 * personal data. Session expiry is not decided here: utils/api logs the user
 * out only when the server rejects the refresh token.
 */
export default defineNuxtPlugin((nuxtApp: NuxtApp) => {
  const report = (error: unknown, properties: Record<string, string>) => {
    try {
      (nuxtApp.$posthog as typeof posthog | undefined)?.captureException(
        sanitizeError(error),
        properties,
      );
    } catch {
      // Reporting must never cause another uncaught error.
    }
  };

  nuxtApp.vueApp.config.errorHandler = (error: unknown, _instance: unknown, info: string) => {
    console.error("[Global Error Handler]", error, info);
    report(error, { source: "vue", vue_info: info });
  };

  window.addEventListener("unhandledrejection", (event) => {
    console.error("[Unhandled Promise Rejection]", event.reason);
    report(event.reason, { source: "unhandledrejection" });
  });
});
