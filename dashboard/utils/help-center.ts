import type { RouterOutputs } from "@/types/trpc";

export type HelpCenterState = RouterOutputs["helpCenter"]["get"];
export type HelpCenterView = NonNullable<HelpCenterState["helpCenter"]>;
export type HelpCenterTheme = HelpCenterView["theme"];
export type HelpCenterCollection = RouterOutputs["helpCenter"]["listCollections"][number];
export type HelpCenterArticle = HelpCenterCollection["articles"][number];
export type HelpCenterPreviewLink = NonNullable<RouterOutputs["helpCenter"]["getPreviewLink"]>;
export type SubdomainProblem = Extract<
  RouterOutputs["helpCenter"]["checkSubdomain"],
  { available: false }
>["reason"];

export interface HelpCenterBasics {
  name: string;
  subdomain: string;
  language: string;
}

export interface HelpCenterCollectionDraft {
  title: string;
  description: string;
  icon: string;
}

/**
 * The theme a new help center starts with. Mirrors DEFAULT_HELP_CENTER_THEME on the
 * server, which the API only returns once a help center exists.
 */
export const DEFAULT_HELP_CENTER_THEME: HelpCenterTheme = {
  accentColor: "#2747d6",
  font: "sans",
  layout: "cards",
  heroTitle: null,
  heroSubtitle: null,
  showPoweredBy: true,
};

/**
 * The site's font stacks (FONT_STACKS in server/services/help-center/render/styles.ts),
 * so each font option can be shown in its own typeface.
 */
export const HELP_CENTER_FONT_STACKS: Record<HelpCenterTheme["font"], string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif',
  rounded:
    'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};
export const HELP_CENTER_FONTS: HelpCenterTheme["font"][] = ["sans", "serif", "rounded", "mono"];

export const HELP_CENTER_LAYOUTS: HelpCenterTheme["layout"][] = ["cards", "list"];

/** A short starting set for collection icons; any emoji can be typed instead. */
export const COLLECTION_EMOJI = [
  "📚",
  "🚀",
  "💡",
  "❓",
  "🛠️",
  "⚙️",
  "💳",
  "📦",
  "🚚",
  "↩️",
  "👤",
  "🔒",
  "💬",
  "📱",
  "💻",
  "🧾",
  "🎁",
  "⭐",
  "📣",
  "🧭",
  "🔌",
  "📊",
  "🏷️",
  "✅",
];
export const COLLECTION_ICON_MAX_LENGTH = 16;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

/** WCAG relative luminance of a `#rrggbb` colour. */
function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** WCAG AA for normal-size text. */
export const MIN_TEXT_CONTRAST = 4.5;

/** Unpadded URL-safe base64 of the text's UTF-8 bytes. */
export function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The `hc_theme` query value that makes the site render with an unsaved theme. */
export function encodeThemeParam(theme: HelpCenterTheme): string {
  return toBase64Url(JSON.stringify(theme));
}

/** The site as it is now, live or not; with `theme`, as it would look with that draft. */
export function previewUrl(link: HelpCenterPreviewLink, theme?: HelpCenterTheme): string {
  const url = `${link.baseUrl}/?hc_preview=${encodeURIComponent(link.token)}`;
  return theme ? `${url}&hc_theme=${encodeThemeParam(theme)}` : url;
}

/** Hero text is optional: an empty field is stored as "not set". */
export function normalizeTheme(theme: HelpCenterTheme): HelpCenterTheme {
  return {
    ...theme,
    accentColor: theme.accentColor.toLowerCase(),
    heroTitle: theme.heroTitle?.trim() || null,
    heroSubtitle: theme.heroSubtitle?.trim() || null,
  };
}

/** The server's reason for a failed call, when it gave one. */
export function errorMessage(error: unknown): string | undefined {
  return error instanceof Error && error.message ? error.message : undefined;
}

/** A copy of `items` with the item at `index` moved one place up (-1) or down (1). */
export function moved<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
