// The chat button, in plain DOM so it paints without Vue. Once the chat chunk
// mounts, it drives the button through the LauncherBridge.
import type { HayChatConfig, LauncherBridge } from "@/types";
import css from "./launcher.css?inline";

const ICON_OPEN =
  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>';
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
  remove(): void;
}

export function createLauncher(config: HayChatConfig, label: string): Launcher {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "hay-webchat-root";
  root.setAttribute("data-theme", config.theme || "blue");

  // .hay-webchat-widget wraps everything, so a host page can remove the
  // whole widget with one selector (the dashboard demo does).
  const widget = document.createElement("div");
  widget.className = "hay-webchat-widget";
  const chatContainer = document.createElement("div");

  const button = document.createElement("button");
  button.type = "button";
  button.className =
    config.position === "left" ? "hay-chat-button hay-chat-button--left" : "hay-chat-button";
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-expanded", "false");
  button.innerHTML =
    icon("hay-chat-button__icon-open", ICON_OPEN) +
    icon("hay-chat-button__icon-close", ICON_CLOSE) +
    '<span class="hay-chat-button__badge" hidden></span>';
  const badge = button.lastElementChild as HTMLElement;

  widget.append(chatContainer, button);
  root.appendChild(widget);
  document.body.appendChild(root);

  return {
    root,
    button,
    chatContainer,
    setOpen(open) {
      button.setAttribute("aria-expanded", String(open));
    },
    setUnread(count) {
      badge.textContent = count > 0 ? String(count) : "";
      badge.hidden = count <= 0;
    },
    setBusy(busy) {
      if (busy) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
    },
    remove() {
      root.remove();
      style.remove();
    },
  };
}
