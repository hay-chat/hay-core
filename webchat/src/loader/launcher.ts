// The chat button, in plain DOM so it paints without Vue. Once the chat chunk
// mounts, it drives the button through the LauncherBridge.
import type {
  HayChatConfig,
  LauncherBridge,
  LauncherIcon,
  LauncherIconStyle,
  PublicConfig,
  ThemeMode,
} from "@/types";
import { brandTokens } from "@/utils/brandColor";
import { launcherIconSvg } from "@/utils/icons";
import type { LauncherLabels } from "./labels";
import css from "./launcher.css?inline";

const ICON_CLOSE =
  '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>';

const icon = (className: string, paths: string) =>
  `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export interface Launcher extends LauncherBridge {
  /** `#hay-webchat-root`, holding the button and the chat. */
  root: HTMLElement;
  button: HTMLButtonElement;
  /** Where the chat chunk mounts. */
  chatContainer: HTMLElement;
  setBusy(busy: boolean): void;
  /** Colour tokens and light/dark theme for the button and the chat. */
  setAppearance(brandColor: string | null | undefined, themeMode: ThemeMode | undefined): void;
  /** The button's icon from the settings: a preset, or the merchant's image. */
  setIcon(icon: LauncherButtonIcon): void;
  /** Hide the button until the merchant's colour is known (see boot.ts). */
  setPending(pending: boolean): void;
  /** The corner from the settings, when the page set none. */
  setPosition(position: NonNullable<PublicConfig["position"]>): void;
  /**
   * Show a message next to the button, until the visitor opens the chat or
   * dismisses it. Does nothing once either has happened, unless `force` (the
   * page asked for it): then only an open chat keeps it away. An empty text
   * removes the message.
   */
  showTeaser(text: string, force?: boolean): void;
  hideTeaser(): void;
  remove(): void;
}

export interface LauncherButtonIcon {
  icon?: LauncherIcon;
  style?: LauncherIconStyle;
  /** For "custom": the image, absolute or relative to the API. */
  url?: string | null;
}

/** The button's icon, as config or the settings give it. */
export function buttonIcon(source: HayChatConfig | PublicConfig | null | undefined) {
  return {
    icon: source?.launcherIcon,
    style: source?.launcherIconStyle,
    url: source?.launcherIconUrl,
  };
}

/** An http(s) URL for `url`, relative ones resolved against the API; anything else null. */
export function httpUrl(url: string | null | undefined, baseUrl: string): string | null {
  if (!url) return null;
  try {
    const resolved = new URL(url, `${baseUrl}/`);
    return resolved.protocol === "https:" || resolved.protocol === "http:" ? resolved.href : null;
  } catch {
    return null;
  }
}

export function createLauncher(config: HayChatConfig, labels: LauncherLabels): Launcher {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "hay-webchat-root";
  // The dashboard's live preview (C4).
  if (config.preview) root.setAttribute("data-preview", "");
  let position = config.position ?? "right";
  const setAppearance: Launcher["setAppearance"] = (brandColor, themeMode) => {
    for (const [name, value] of Object.entries(brandTokens(brandColor))) {
      root.style.setProperty(name, value);
    }
    root.setAttribute("data-theme-mode", themeMode ?? "light");
    // A custom icon image is recoloured to the icon colour (white or near-black).
    root.toggleAttribute(
      "data-launcher-dark-icon",
      brandTokens(brandColor)["--hay-launcher-icon"] !== "#ffffff",
    );
  };
  setAppearance(config.brandColor, config.themeMode);

  // .hay-webchat-widget wraps everything, so a host page can remove the
  // whole widget with one selector (the dashboard demo does).
  const widget = document.createElement("div");
  widget.className = "hay-webchat-widget";
  const chatContainer = document.createElement("div");

  const button = document.createElement("button");
  button.type = "button";
  const placeButton = () => {
    button.className =
      position === "left" ? "hay-chat-button hay-chat-button--left" : "hay-chat-button";
  };
  placeButton();
  button.setAttribute("aria-label", labels.open);
  button.setAttribute("aria-expanded", "false");
  button.innerHTML =
    launcherIconSvg("chat", "outline", "hay-chat-button__icon-open") +
    icon("hay-chat-button__icon-close", ICON_CLOSE) +
    '<span class="hay-chat-button__badge" hidden></span>';
  const badge = button.lastElementChild as HTMLElement;

  // The default (no setting yet) is the outlined chat bubble.
  const setIcon: Launcher["setIcon"] = ({ icon: name, style, url }) => {
    let next: Element;
    const imageUrl = name === "custom" ? httpUrl(url, config.baseUrl) : null;
    if (imageUrl) {
      const image = document.createElement("img");
      image.className = "hay-chat-button__icon-open hay-chat-button__icon-image";
      image.alt = "";
      image.src = imageUrl;
      next = image;
    } else {
      const preset = name && name !== "custom" ? name : "chat";
      const template = document.createElement("template");
      template.innerHTML = launcherIconSvg(
        preset,
        style ?? "outline",
        "hay-chat-button__icon-open",
      );
      next = template.content.firstElementChild!;
    }
    button.querySelector(".hay-chat-button__icon-open")?.replaceWith(next);
  };
  if (config.launcherIcon) setIcon(buttonIcon(config));

  widget.append(chatContainer, button);
  root.appendChild(widget);
  document.body.appendChild(root);

  let teaser: HTMLElement | null = null;
  // Set once the chat was opened or the teaser dismissed: it never comes back.
  let teaserDone = false;
  const hideTeaser = () => {
    teaserDone = true;
    teaser?.remove();
    teaser = null;
  };

  return {
    root,
    button,
    chatContainer,
    setOpen(open) {
      button.setAttribute("aria-expanded", String(open));
      if (open) hideTeaser();
    },
    setUnread(count) {
      badge.textContent = count > 0 ? String(count) : "";
      badge.hidden = count <= 0;
    },
    focus() {
      button.focus();
    },
    setAppearance,
    setIcon,
    setPending(pending) {
      root.toggleAttribute("data-pending", pending);
    },
    setPosition(next) {
      position = next;
      placeButton();
      teaser?.classList.toggle("hay-chat-teaser--left", position === "left");
    },
    setSheet(sheet) {
      root.toggleAttribute("data-sheet", sheet);
    },
    setBusy(busy) {
      if (busy) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
    },
    showTeaser(text, force = false) {
      if (force) teaserDone = false;
      if (teaserDone) return;
      teaser?.remove();
      teaser = null;
      const message = text.trim();
      if (!message || button.getAttribute("aria-expanded") === "true") return;

      teaser = document.createElement("div");
      teaser.className =
        position === "left" ? "hay-chat-teaser hay-chat-teaser--left" : "hay-chat-teaser";

      // The message opens the chat, exactly like the button.
      const open = document.createElement("button");
      open.type = "button";
      open.className = "hay-chat-teaser__message";
      open.textContent = message;
      open.addEventListener("click", () => button.click());

      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "hay-chat-teaser__dismiss";
      dismiss.setAttribute("aria-label", labels.dismissTeaser);
      dismiss.innerHTML = icon("hay-chat-teaser__dismiss-icon", ICON_CLOSE);
      dismiss.addEventListener("click", hideTeaser);

      teaser.append(open, dismiss);
      // Before the button, so keyboard users reach the message first.
      widget.insertBefore(teaser, button);
    },
    hideTeaser,
    remove() {
      root.remove();
      style.remove();
    },
  };
}
