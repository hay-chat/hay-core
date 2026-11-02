import {
  baseSecurityHeaders,
  contentSecurityPolicy,
  inlineScriptBodies,
  scriptHashSource,
} from "../utils/security-headers";

/**
 * Security headers for the dashboard. Production only: the Vite dev server
 * relies on inline scripts and eval for HMR.
 */
export default defineNitroPlugin((nitroApp) => {
  if (import.meta.dev) return;

  nitroApp.hooks.hook("request", (event) => {
    const { useSSL } = useRuntimeConfig(event).public;
    setResponseHeaders(event, baseSecurityHeaders(useSSL === true));
  });

  nitroApp.hooks.hook("render:html", (html, { event }) => {
    const { apiBaseUrl, posthogKey, posthogHost, useSSL } = useRuntimeConfig(event).public;
    const inlineScripts = [...html.head, ...html.bodyPrepend, ...html.body, ...html.bodyAppend]
      .flatMap(inlineScriptBodies)
      .map(scriptHashSource);
    setResponseHeader(
      event,
      "Content-Security-Policy",
      contentSecurityPolicy(
        {
          apiBaseUrl: String(apiBaseUrl ?? ""),
          posthogHost: posthogKey ? String(posthogHost ?? "") : undefined,
          useSSL: useSSL === true,
        },
        inlineScripts,
      ),
    );
  });
});
