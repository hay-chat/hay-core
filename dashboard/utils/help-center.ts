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
  colorScheme: "auto",
  corners: "rounded",
  heroStyle: "solid",
  heroAlign: "center",
  heroGradientFrom: "#2747d6",
  heroGradientTo: "#142a8c",
  heroGradientDirection: "diagonal",
  heroOverlay: "medium",
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
  serif: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif',
  rounded:
    'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};
export const HELP_CENTER_FONTS: HelpCenterTheme["font"][] = ["sans", "serif", "rounded", "mono"];

export const HELP_CENTER_LAYOUTS: HelpCenterTheme["layout"][] = ["cards", "list"];
export const HELP_CENTER_COLOR_SCHEMES: HelpCenterTheme["colorScheme"][] = [
  "auto",
  "light",
  "dark",
];
export const HELP_CENTER_CORNERS: HelpCenterTheme["corners"][] = ["sharp", "rounded", "pill"];
export const HELP_CENTER_HERO_STYLES: HelpCenterTheme["heroStyle"][] = [
  "solid",
  "gradient",
  "tint",
  "image",
  "plain",
];
export const HELP_CENTER_HERO_ALIGNS: HelpCenterTheme["heroAlign"][] = ["center", "left"];
export const HELP_CENTER_HERO_OVERLAYS: HelpCenterTheme["heroOverlay"][] = [
  "light",
  "medium",
  "strong",
];

/** The site's gradient angles (GRADIENT_ANGLES in server/services/help-center/render/styles.ts). */
export const HELP_CENTER_GRADIENT_ANGLES: Record<HelpCenterTheme["heroGradientDirection"], string> =
  { diagonal: "135deg", right: "90deg", down: "180deg" };
export const HELP_CENTER_GRADIENT_DIRECTIONS = Object.keys(
  HELP_CENTER_GRADIENT_ANGLES,
) as HelpCenterTheme["heroGradientDirection"][];

/** The settings a preset sets. The accent colour and the hero text stay the customer's own. */
export type HelpCenterPresetStyle = Partial<
  Pick<
    HelpCenterTheme,
    | "font"
    | "layout"
    | "colorScheme"
    | "corners"
    | "heroStyle"
    | "heroAlign"
    | "heroGradientFrom"
    | "heroGradientTo"
    | "heroGradientDirection"
  >
>;

export interface HelpCenterPreset {
  id: "classic" | "aurora" | "minimal" | "midnight" | "editorial" | "playful";
  style: HelpCenterPresetStyle;
}

/**
 * Ready-made looks, applied in one click and then adjustable. Gradient stops are chosen so
 * the hero text passes 4.5:1 on both. Every preset sets the same core settings, so picking
 * one fully replaces the look of another.
 */
export const HELP_CENTER_PRESETS: HelpCenterPreset[] = [
  {
    id: "classic",
    style: {
      font: "sans",
      layout: "cards",
      colorScheme: "auto",
      corners: "rounded",
      heroStyle: "solid",
      heroAlign: "center",
    },
  },
  {
    id: "aurora",
    style: {
      font: "sans",
      layout: "cards",
      colorScheme: "auto",
      corners: "rounded",
      heroStyle: "gradient",
      heroAlign: "center",
      heroGradientFrom: "#0c3f4d",
      heroGradientTo: "#1a7a63",
      heroGradientDirection: "diagonal",
    },
  },
  {
    id: "minimal",
    style: {
      font: "sans",
      layout: "cards",
      colorScheme: "light",
      corners: "rounded",
      heroStyle: "plain",
      heroAlign: "left",
    },
  },
  {
    id: "midnight",
    style: {
      font: "sans",
      layout: "cards",
      colorScheme: "dark",
      corners: "rounded",
      heroStyle: "gradient",
      heroAlign: "center",
      heroGradientFrom: "#0b1026",
      heroGradientTo: "#1c2a5a",
      heroGradientDirection: "down",
    },
  },
  {
    id: "editorial",
    style: {
      font: "serif",
      layout: "list",
      colorScheme: "auto",
      corners: "sharp",
      heroStyle: "tint",
      heroAlign: "left",
    },
  },
  {
    id: "playful",
    style: {
      font: "rounded",
      layout: "cards",
      colorScheme: "auto",
      corners: "pill",
      heroStyle: "gradient",
      heroAlign: "center",
      heroGradientFrom: "#bbf7d0",
      heroGradientTo: "#bae6fd",
      heroGradientDirection: "right",
    },
  },
];

/** The theme with the preset's look; accent colour, hero text and footer are kept. */
export function applyPreset(theme: HelpCenterTheme, preset: HelpCenterPreset): HelpCenterTheme {
  return { ...theme, ...preset.style };
}

/** The preset whose every setting the theme has, if any. */
export function matchingPreset(theme: HelpCenterTheme): HelpCenterPreset | null {
  return (
    HELP_CENTER_PRESETS.find((preset) =>
      Object.entries(preset.style).every(
        ([key, value]) => String(theme[key as keyof HelpCenterPresetStyle]).toLowerCase() === value,
      ),
    ) ?? null
  );
}

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

/**
 * Black or white, whichever reads better on all the colours (the stops of a gradient), as
 * the site picks it (readableTextOn in server/services/help-center/render/styles.ts), with
 * its contrast on the worst of them.
 */
export function readableTextOn(...colors: string[]): { color: string; contrast: number } {
  const worst = (text: string) => Math.min(...colors.map((color) => contrastRatio(color, text)));
  const [black, white] = [worst("#000000"), worst("#ffffff")];
  return black >= white
    ? { color: "#000000", contrast: black }
    : { color: "#ffffff", contrast: white };
}

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
    heroGradientFrom: theme.heroGradientFrom.toLowerCase(),
    heroGradientTo: theme.heroGradientTo.toLowerCase(),
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
