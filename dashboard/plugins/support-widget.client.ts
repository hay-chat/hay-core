import { mountSupportWidget } from "@/utils/support-widget";
import { useDomain } from "@/composables/useDomain";
import { usePageTools } from "@/composables/usePageTools";

/**
 * Embeds Hay's own support assistant when SUPPORT_WIDGET_ORG_ID is set; a no-op otherwise.
 * Once the widget loads it receives the dashboard's page tools, so the assistant can point at
 * and open pages ("where do I connect Shopify?"). The demo page loads its own widget.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const organizationId = useRuntimeConfig().public.supportWidgetOrgId;
  if (!organizationId) return;

  const baseUrl = useDomain().getApiUrl();
  const { registerWithWidget } = usePageTools();

  nuxtApp.hook("app:mounted", () => {
    if (window.location.pathname.startsWith("/demo/")) return;
    mountSupportWidget(organizationId, baseUrl, registerWithWidget);
  });
});
