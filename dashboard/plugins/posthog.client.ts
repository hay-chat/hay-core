import posthog, { type PostHogConfig } from "posthog-js";

/**
 * Product analytics only: autocapture keeps click/interaction events but with
 * every element's text and attributes masked, and session replays mask all
 * text and inputs, so customer names and messages on screen never leave the
 * browser.
 */
export const posthogOptions: Partial<PostHogConfig> = {
  // Always point UI links at PostHog itself — POSTHOG_HOST may be a reverse proxy
  ui_host: "https://eu.posthog.com",
  defaults: "2026-01-30",
  person_profiles: "identified_only",
  capture_pageview: false,
  capture_pageleave: true,
  autocapture: true,
  mask_all_text: true,
  mask_all_element_attributes: true,
  session_recording: { maskAllInputs: true, maskTextSelector: "*" },
};

/** Pageview URL without query string or hash (they can carry tokens). */
export function pageviewUrl(origin: string, path: string): string {
  return origin + path;
}

// Loads PostHog only when POSTHOG_KEY is set at build time.
// Without a key this plugin is a no-op and no telemetry is collected.
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();
  const key = config.public.posthogKey;

  if (!key) {
    return;
  }

  posthog.init(key, { ...posthogOptions, api_host: config.public.posthogHost });

  // Manual pageview capture for SPA route changes
  const router = useRouter();
  router.afterEach((to) => {
    posthog.capture("$pageview", { $current_url: pageviewUrl(window.location.origin, to.path) });
  });

  return {
    provide: {
      posthog,
    },
  };
});
