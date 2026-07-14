import posthog from "posthog-js";

// Loads PostHog only when POSTHOG_KEY is set at build time.
// Without a key this plugin is a no-op and no telemetry is collected.
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();
  const key = config.public.posthogKey;

  if (!key) {
    return;
  }

  posthog.init(key, {
    api_host: config.public.posthogHost,
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
  });

  // Manual pageview capture for SPA route changes
  const router = useRouter();
  router.afterEach((to) => {
    posthog.capture("$pageview", { $current_url: window.location.origin + to.fullPath });
  });

  return {
    provide: {
      posthog,
    },
  };
});
