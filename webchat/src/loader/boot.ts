import { resolveLocale } from "@/i18n/resolve";
import type { ChatHandle, ChatMountOptions, HayChatConfig, PublicConfig } from "@/types";
import { installHostApi } from "./hostApi";
import { launcherLabels } from "./labels";
import { createLauncher } from "./launcher";
import { fetchPublicConfig } from "./publicConfig";

/** Longest the button stays hidden waiting for the merchant's colour. */
const APPEARANCE_WAIT_MS = 2000;

export interface ChatModule {
  mountChat(options: ChatMountOptions): Promise<ChatHandle>;
}

/**
 * The visitor already chatted in this tab. Only the chat writes this key, and
 * only after the visitor's first message (see useConsent), so reading it
 * stores nothing and touches nothing for visitors who never chatted.
 */
function hasConversationInTab(): boolean {
  try {
    return sessionStorage.getItem("hay-conversation-id") !== null;
  } catch {
    return false;
  }
}

/** After the page's load event, when the browser is idle (or after 3 s). */
function whenIdle(callback: () => void): void {
  const schedule = () => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(callback, { timeout: 3000 });
    else setTimeout(callback, 1500);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
}

/**
 * Paint the button straight away and load the chat according to
 * `config.loading`. Returns a promise for the mounted chat, for tests.
 */
export function boot(
  config: HayChatConfig,
  loadChat: () => Promise<ChatModule>,
): { chatReady: () => Promise<ChatHandle | null> } {
  if (!config.organizationId) console.error("[Hay Webchat] organizationId is required in config");
  if (!config.baseUrl) console.error("[Hay Webchat] baseUrl is required in config");

  const hostCalls = installHostApi();
  const launcher = createLauncher(config, launcherLabels[resolveLocale(config.locale)]);

  // The teaser invites a first conversation, so a visitor who already has one
  // in this tab is not shown it. The page's own message (even an empty one)
  // wins over the one from the settings.
  const wantsTeaser = !hasConversationInTab();
  let pageSetTeaser = config.teaserMessage !== undefined;
  if (wantsTeaser && config.teaserMessage) launcher.showTeaser(config.teaserMessage);
  // Asked for by the page just now, so it shows whatever happened before.
  (window.HayChat ??= {}).setTeaserMessage = (message) => {
    pageSetTeaser = true;
    launcher.showTeaser(String(message ?? ""), true);
  };

  const mode = hasConversationInTab() ? "eager" : (config.loading ?? "idle");

  // The button takes the merchant's colour from the settings. When the settings
  // are fetched straight away (idle, eager) and the page set no colour, the
  // button waits for them (or APPEARANCE_WAIT_MS) instead of flashing the
  // default colour first. "interaction" fetches nothing up front, so it paints
  // at once, in the page's colour or the default.
  const waitForAppearance = mode !== "interaction" && !config.brandColor;
  let appearanceTimer: ReturnType<typeof setTimeout> | undefined;
  if (waitForAppearance) {
    launcher.setPending(true);
    appearanceTimer = setTimeout(() => launcher.setPending(false), APPEARANCE_WAIT_MS);
  }

  let publicConfig: Promise<PublicConfig | null> | null = null;
  const getPublicConfig = () =>
    (publicConfig ??= fetchPublicConfig(config).then((settings) => {
      // The page's own colour and theme win over the settings.
      launcher.setAppearance(
        config.brandColor ?? settings?.brandColor,
        config.themeMode ?? settings?.themeMode,
      );
      clearTimeout(appearanceTimer);
      launcher.setPending(false);
      if (wantsTeaser && !pageSetTeaser && settings?.teaserMessage) {
        launcher.showTeaser(settings.teaserMessage);
      }
      return settings;
    }));

  // Widget turned off (or organization suspended): remove the button.
  let disabled = false;
  const checkEnabled = async () => {
    if ((await getPublicConfig())?.enabled === false) {
      disabled = true;
      launcher.remove();
    }
    return !disabled;
  };

  let handle: ChatHandle | null = null;
  let wantOpen = false;
  let chat: Promise<ChatHandle | null> | null = null;

  const startChat = (urgent = false): Promise<ChatHandle | null> =>
    (chat ??= (async () => {
      if (disabled) return null;
      // When the chat is needed now (click, eager, a conversation in this tab),
      // fetch the settings and the chunk side by side. Otherwise (idle) ask the
      // settings first, so a disabled widget never downloads the chat.
      const chunk = urgent || wantOpen ? loadChat() : null;
      if (!(await checkEnabled())) return null;
      const module = await (chunk ?? loadChat());
      handle = await module.mountChat({
        container: launcher.chatContainer,
        config,
        publicConfig: await getPublicConfig(),
        launcher,
        hostCalls,
        open: wantOpen,
      });
      return handle;
    })()
      .catch((error) => {
        console.error("[Hay Webchat] Failed to load the chat:", error);
        chat = null; // a later click tries again
        return null;
      })
      .finally(() => launcher.setBusy(false)));

  launcher.button.addEventListener("click", () => {
    if (handle) {
      handle.toggle();
      return;
    }
    wantOpen = true;
    launcher.hideTeaser();
    launcher.setBusy(true);
    void startChat();
  });

  // Intent: the visitor is reaching for the button, so start downloading.
  const onIntent = () => void startChat(true);
  launcher.button.addEventListener("pointerenter", onIntent, { once: true });
  launcher.button.addEventListener("focus", onIntent, { once: true });
  launcher.button.addEventListener("touchstart", onIntent, { once: true, passive: true });

  if (mode === "eager") {
    void startChat(true);
  } else if (mode === "idle") {
    void checkEnabled();
    whenIdle(() => void startChat());
  }
  // "interaction": nothing is fetched until the visitor reaches for the button.

  return { chatReady: () => chat ?? Promise.resolve(null) };
}
