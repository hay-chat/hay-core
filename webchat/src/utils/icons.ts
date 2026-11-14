// Icons the merchant picks in Settings > Webchat: the assistant's avatar and
// the chat button. Plain SVG strings (our own, never user input), so the
// loader can use them without Vue.
// The dashboard draws the same shapes in its picker:
// dashboard/components/webchat/WebchatIcon.vue.
import type { AssistantAvatarPreset, LauncherIcon, LauncherIconStyle } from "@/types";

const SPARKLE = '<path d="M12 2.5l2.1 6.4 6.4 2.1-6.4 2.1L12 19.5l-2.1-6.4L3.5 11l6.4-2.1z"/>';
const SPARKLES =
  '<path d="M10 3l1.6 4.9L16.5 9.5l-4.9 1.6L10 16l-1.6-4.9L3.5 9.5l4.9-1.6z"/>' +
  '<path d="M18 13l.8 2.2 2.2.8-2.2.8L18 19l-.8-2.2-2.2-.8 2.2-.8z"/>';
const CHAT = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';
// The filled robot has its eyes cut out, so it is its own shape.
const ROBOT_FILLED =
  '<path fill-rule="evenodd" d="M11.25 4.3A1.5 1.5 0 1 1 12.75 4.3V7.5H17a3 3 0 0 1 3 3v6.5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6.5a3 3 0 0 1 3-3h4.25zM8.25 12.25a1 1 0 0 0-1 1v1.5a1 1 0 0 0 2 0v-1.5a1 1 0 0 0-1-1zm7.5 0a1 1 0 0 0-1 1v1.5a1 1 0 0 0 2 0v-1.5a1 1 0 0 0-1-1z"/>' +
  '<rect x="1.25" y="12" width="1.5" height="5" rx=".75"/><rect x="21.25" y="12" width="1.5" height="5" rx=".75"/>';
const ROBOT_OUTLINE =
  '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><circle cx="12" cy="3.5" r="1"/>' +
  '<path d="M9 13v1.5M15 13v1.5M2 13v3M22 13v3"/>';

const svg = (inner: string, filled: boolean, className = "") =>
  `<svg${className ? ` class="${className}"` : ""} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ` +
  (filled
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"') +
  ` aria-hidden="true">${inner}</svg>`;

/** The assistant's avatar glyph (always filled), drawn in the brand colour. */
export function assistantAvatarSvg(preset: AssistantAvatarPreset | undefined): string {
  if (preset === "robot") return svg(ROBOT_FILLED, true);
  if (preset === "sparkles") return svg(SPARKLES, true);
  return svg(SPARKLE, true);
}

/** A preset chat button icon. */
export function launcherIconSvg(
  icon: Exclude<LauncherIcon, "custom">,
  style: LauncherIconStyle,
  className: string,
): string {
  const filled = style === "filled";
  if (icon === "robot") return svg(filled ? ROBOT_FILLED : ROBOT_OUTLINE, filled, className);
  if (icon === "sparkle") return svg(SPARKLE, filled, className);
  return svg(CHAT, filled, className);
}
