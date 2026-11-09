/**
 * Hay's own support assistant, embedded in the dashboard. It is the same webchat widget customers
 * embed, pointed at one organization on this deployment (the one that runs Hay's assistant).
 * Off unless SUPPORT_WIDGET_ORG_ID is set, so self-hosted installs show nothing.
 */

const WIDGET_PATH = "/v1/webchat/widget.js";

/** The widget config for the dashboard's support assistant, or null when it is not configured. */
export function supportWidgetConfig(organizationId: string, baseUrl: string) {
  if (!organizationId.trim() || !baseUrl) return null;
  return {
    organizationId: organizationId.trim(),
    baseUrl,
    position: "right",
    theme: "blue",
    // Tells the assistant it is inside the product, not on the marketing site.
    context: { surface: "hay-dashboard" },
  };
}

/** Loads widget.js once. Returns false when not configured or already loaded. */
export function mountSupportWidget(
  organizationId: string,
  baseUrl: string,
  onLoad: () => void,
  win: Window = window,
): boolean {
  const config = supportWidgetConfig(organizationId, baseUrl);
  if (!config || win.document.querySelector(`script[src$="${WIDGET_PATH}"]`)) return false;

  win.HayChat = win.HayChat || {};
  win.HayChat.config = config;
  const script = win.document.createElement("script");
  script.src = `${baseUrl}${WIDGET_PATH}`;
  script.async = true;
  script.onload = onLoad;
  win.document.body.appendChild(script);
  return true;
}
