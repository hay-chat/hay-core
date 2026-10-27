// The chat chunk: Vue, the chat window, the socket, DPoP and markdown. widget.js
// (src/loader) downloads it on intent or when the browser is idle and calls
// mountChat(). Built as a hashed file with a long immutable cache.
import { createApp } from "vue";
import Widget from "./Widget.vue";
import { addContext } from "./composables/useWidgetContext";
import { initConsent, grantConsent, revokeConsent } from "./composables/useConsent";
import { loadTranslations } from "./i18n";
import { setDebug, debugLog } from "./utils/debug";
import type { ChatHandle, ChatMountOptions, HostCall } from "./types";
import "./styles/widget.css";

const hostApi = { addContext, grantConsent, revokeConsent };

function replay(call: HostCall): void {
  if (call.name === "addContext") addContext(...call.args);
  else hostApi[call.name]();
}

export async function mountChat(options: ChatMountOptions): Promise<ChatHandle> {
  const { config } = options;
  setDebug(config.debug);

  // Initialize ePrivacy consent gate before any composable touches storage,
  // then apply what the host page asked for while the chat was loading.
  initConsent(config.consent);
  options.hostCalls.forEach(replay);
  // From now on the host page talks to the chat directly.
  if (window.HayChat) Object.assign(window.HayChat, hostApi);

  const translations = await loadTranslations(config.locale);

  // Widget exposes toggle() (defineExpose), which is all the loader needs.
  const widget = createApp(Widget, {
    config,
    publicConfig: options.publicConfig,
    launcher: options.launcher,
    translations,
    openOnMount: options.open,
  }).mount(options.container) as unknown as ChatHandle;

  debugLog("[Hay Webchat] Chat loaded", { organizationId: config.organizationId });
  return { toggle: () => widget.toggle() };
}
