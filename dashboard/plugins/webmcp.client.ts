import { defineNuxtPlugin } from "nuxt/app";
import { usePageTools } from "@/composables/usePageTools";

/**
 * WebMCP: when the browser ships `navigator.modelContext`, hand its agent the
 * same page tools the Hay widget gets, so "open my inbox" works from the
 * browser's side panel too. Browsers without it get nothing here; the widget
 * registers the tools itself on the demo page.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("app:mounted", () => {
    if (!navigator.modelContext) return;
    usePageTools().registerWithBrowser();
  });
});
