// The chat chunk: Vue, the chat window, the socket, DPoP and markdown. widget.js
// (src/loader) downloads it on intent or when the browser is idle and calls
// mountChat(). Built as a hashed file with a long immutable cache.
// Base styles first, so the components' own rules override them.
import "./styles/widget.css";
import { createApp } from "vue";
import Widget from "./Widget.vue";
import type { WidgetPreview } from "./composables/useChat";
import { addContext } from "./composables/useWidgetContext";
import {
  initConsent,
  configureConsentRecording,
  grantConsent,
  revokeConsent,
} from "./composables/useConsent";
import { registerTool, unregisterTool, provideContext } from "./composables/usePageTools";
import { highlight } from "./utils/agentActivity";
import { loadTranslations, type Translations } from "./i18n";
import { setDebug, debugLog } from "./utils/debug";
import type { ChatHandle, ChatMountOptions, HayChatConfig, HostCall } from "./types";

const hostApi = {
  addContext,
  grantConsent,
  revokeConsent,
  registerTool,
  unregisterTool,
  highlight,
};

function replay(call: HostCall): void {
  switch (call.name) {
    case "addContext":
      return addContext(...call.args);
    case "registerTool":
      return registerTool(...call.args);
    case "unregisterTool":
      return unregisterTool(...call.args);
    case "provideContext":
      return provideContext(...call.args);
    default:
      return hostApi[call.name]();
  }
}

export async function mountChat(options: ChatMountOptions): Promise<ChatHandle> {
  const { config } = options;
  setDebug(config.debug);

  // The dashboard's preview (C4) has no visitor: no consent, no host page API.
  if (!config.preview) {
    // Initialize ePrivacy consent gate before any composable touches storage,
    // then apply what the host page asked for while the chat was loading.
    initConsent(config.consent);
    configureConsentRecording(config.baseUrl, config.organizationId);
    options.hostCalls.forEach(replay);
    // From now on the host page talks to the chat directly.
    if (window.HayChat) Object.assign(window.HayChat, hostApi);
  }

  const translations = await loadTranslations(config.locale);
  const preview = config.preview ? await loadPreview(config, translations) : undefined;

  // Widget exposes toggle() (defineExpose), which is all the loader needs.
  const widget = createApp(Widget, {
    config,
    publicConfig: options.publicConfig,
    launcher: options.launcher,
    translations,
    openOnMount: options.open,
    preview,
  }).mount(options.container) as unknown as ChatHandle;

  debugLog("[Hay Webchat] Chat loaded", { organizationId: config.organizationId });
  return { toggle: () => widget.toggle() };
}

/** Sample content for the preview, in its own chunk: shoppers never download it. */
async function loadPreview(
  config: HayChatConfig,
  translations: Translations,
): Promise<WidgetPreview | undefined> {
  if (!config.preview) return undefined;
  const sample = await import("./preview");
  return {
    chat: sample.createPreviewChat(config.preview),
    availability: sample.PREVIEW_AVAILABILITY,
    conversations: sample.previewConversations(config.agentName || translations["chat.assistant"]),
  };
}
