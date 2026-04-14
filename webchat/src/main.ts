import { createApp } from "vue";
import Widget from "./Widget.vue";
import type { HayChatConfig } from "./types";
import { addContext } from "./composables/useWidgetContext";
import { initConsent, grantConsent, revokeConsent } from "./composables/useConsent";
import "./styles/widget.css";

// Get config from window object or use defaults
const defaultConfig: HayChatConfig = {
  organizationId: "",
  baseUrl: "http://localhost:3001",
  position: "right",
  theme: "blue",
  showGreeting: true,
};

const config = { ...defaultConfig, ...window.HayChat?.config };

// Initialize ePrivacy consent gate before any composable touches storage.
initConsent(config.consent);

// Validate required config
if (!config.organizationId) {
  console.error("[Hay Webchat] organizationId is required in config");
}

if (!config.baseUrl) {
  console.error("[Hay Webchat] baseUrl is required in config");
}

// Create widget container
const container = document.createElement("div");
container.id = "hay-webchat-root";
container.setAttribute("data-theme", config.theme || "blue");
document.body.appendChild(container);

// Mount the widget
const app = createApp(Widget, { config });
app.mount(container);

// Expose host-facing APIs on window.HayChat so host developers can call
// addContext / grantConsent / revokeConsent from their own page scripts.
if (window.HayChat) {
  window.HayChat.addContext = addContext;
  window.HayChat.grantConsent = grantConsent;
  window.HayChat.revokeConsent = revokeConsent;
}

console.log("[Hay Webchat] Widget loaded", { organizationId: config.organizationId });
