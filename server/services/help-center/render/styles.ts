/**
 * The site's stylesheet and the per-site theme variables.
 *
 * The stylesheet is the same for every help center, so it is served once
 * under a content-hashed address and cached for good. What differs per site
 * is a handful of CSS custom properties written into each page, and a few
 * classes on `<body>` and the hero that pick variants out of the stylesheet.
 */
import crypto from "crypto";
import {
  DEFAULT_HELP_CENTER_THEME,
  HELP_CENTER_COLOR_SCHEMES,
  HELP_CENTER_CORNERS,
  HELP_CENTER_FONTS,
  HELP_CENTER_GRADIENT_DIRECTIONS,
  HELP_CENTER_HERO_ALIGNS,
  HELP_CENTER_HERO_OVERLAYS,
  HELP_CENTER_HERO_STYLES,
  type HelpCenterFont,
  type HelpCenterGradientDirection,
  type HelpCenterHeroOverlay,
  type HelpCenterHeroStyle,
  type HelpCenterTheme,
} from "@server/database/entities/help-center.entity";
import { raw, type SafeHtml } from "./html";

/** System fonts only: a visitor's browser asks no third party for anything. */
const FONT_STACKS: Record<HelpCenterFont, string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif',
  rounded:
    'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

const GRADIENT_ANGLES: Record<HelpCenterGradientDirection, string> = {
  diagonal: "135deg",
  right: "90deg",
  down: "180deg",
};

/** Opacity of the black layer over a hero image; white text sits on top. */
const OVERLAY_OPACITY: Record<HelpCenterHeroOverlay, string> = {
  light: "0.4",
  medium: "0.55",
  strong: "0.75",
};

interface Palette {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
}

const LIGHT: Palette = {
  background: "#ffffff",
  surface: "#f4f5f7",
  text: "#16181d",
  muted: "#5c6370",
  border: "#e3e6ea",
};
const DARK: Palette = {
  background: "#0f1115",
  surface: "#181b21",
  text: "#eceef1",
  muted: "#a1a8b3",
  border: "#2a2f37",
};

function paletteCss(palette: Palette): string {
  return (
    `--hc-bg: ${palette.background}; --hc-surface: ${palette.surface}; ` +
    `--hc-text: ${palette.text}; --hc-muted: ${palette.muted}; --hc-border: ${palette.border};`
  );
}

/** WCAG AA for body text. */
const MIN_TEXT_CONTRAST = 4.5;

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/** Black or white, whichever reads better on every one of the colours (a gradient's stops). */
export function readableTextOn(...colors: string[]): "#000000" | "#ffffff" {
  const worst = (text: string) => Math.min(...colors.map((color) => contrastRatio(color, text)));
  return worst("#000000") >= worst("#ffffff") ? "#000000" : "#ffffff";
}

/** The accent as a link colour when it is readable on the background, else the text colour. */
function linkColor(accent: string, palette: Palette): string {
  return contrastRatio(accent, palette.background) >= MIN_TEXT_CONTRAST ? accent : palette.text;
}

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

function hexOr(value: unknown, fallback: string): string {
  return isHexColor(value) ? value.toLowerCase() : fallback;
}

/**
 * The page's theme `<style>`. The theme is stored JSON and, in preview, comes
 * from the query string, so nothing from it is trusted: colours must be
 * `#rrggbb` and every other value one of ours, or the default is used. Only
 * values built here reach CSS.
 */
export function themeCss(theme: Partial<HelpCenterTheme>): SafeHtml {
  const defaults = DEFAULT_HELP_CENTER_THEME;
  const accent = hexOr(theme.accentColor, defaults.accentColor);
  const from = hexOr(theme.heroGradientFrom, defaults.heroGradientFrom);
  const to = hexOr(theme.heroGradientTo, defaults.heroGradientTo);
  const font = FONT_STACKS[oneOf(HELP_CENTER_FONTS, theme.font, defaults.font)];
  const angle =
    GRADIENT_ANGLES[
      oneOf(
        HELP_CENTER_GRADIENT_DIRECTIONS,
        theme.heroGradientDirection,
        defaults.heroGradientDirection,
      )
    ];
  const overlay =
    OVERLAY_OPACITY[oneOf(HELP_CENTER_HERO_OVERLAYS, theme.heroOverlay, defaults.heroOverlay)];
  const scheme = oneOf(HELP_CENTER_COLOR_SCHEMES, theme.colorScheme, defaults.colorScheme);

  const link =
    scheme === "auto"
      ? `--hc-link:${linkColor(accent, LIGHT)}}` +
        `@media (prefers-color-scheme:dark){:root{--hc-link:${linkColor(accent, DARK)}}}`
      : `--hc-link:${linkColor(accent, scheme === "dark" ? DARK : LIGHT)}}`;
  return raw(
    `:root{--hc-accent:${accent};--hc-on-accent:${readableTextOn(accent)};--hc-font:${font};` +
      `--hc-hero-from:${from};--hc-hero-to:${to};--hc-hero-angle:${angle};` +
      `--hc-on-gradient:${readableTextOn(from, to)};--hc-hero-overlay:${overlay};` +
      link,
  );
}

/** Classes for `<body>`: the colour scheme and the corner style, each one of ours. */
export function bodyClass(theme: Partial<HelpCenterTheme>): string {
  const defaults = DEFAULT_HELP_CENTER_THEME;
  const scheme = oneOf(HELP_CENTER_COLOR_SCHEMES, theme.colorScheme, defaults.colorScheme);
  const corners = oneOf(HELP_CENTER_CORNERS, theme.corners, defaults.corners);
  return `hc-scheme-${scheme} hc-corners-${corners}`;
}

/** The hero's style as shown: an image hero without an image shows the accent colour. */
export function heroStyle(theme: Partial<HelpCenterTheme>, hasImage: boolean): HelpCenterHeroStyle {
  const style = oneOf(
    HELP_CENTER_HERO_STYLES,
    theme.heroStyle,
    DEFAULT_HELP_CENTER_THEME.heroStyle,
  );
  return style === "image" && !hasImage ? "solid" : style;
}

/** Classes for the hero section, each one of ours. */
export function heroClass(theme: Partial<HelpCenterTheme>, hasImage: boolean): string {
  const align = oneOf(
    HELP_CENTER_HERO_ALIGNS,
    theme.heroAlign,
    DEFAULT_HELP_CENTER_THEME.heroAlign,
  );
  return `hc-hero hc-hero-${heroStyle(theme, hasImage)} hc-hero-${align}`;
}

export const SITE_CSS = `
:root {
  color-scheme: light dark;
  ${paletteCss(LIGHT)}
  --hc-radius: 14px;
  --hc-control-radius: 10px;
  --hc-shadow: 0 1px 2px rgb(16 24 40 / 0.05), 0 8px 24px -12px rgb(16 24 40 / 0.18);
}
@media (prefers-color-scheme: dark) {
  :root { ${paletteCss(DARK)} --hc-shadow: 0 1px 2px rgb(0 0 0 / 0.4), 0 10px 30px -12px rgb(0 0 0 / 0.6); }
}
.hc-scheme-light { color-scheme: light; ${paletteCss(LIGHT)} }
.hc-scheme-dark { color-scheme: dark; ${paletteCss(DARK)} --hc-shadow: 0 1px 2px rgb(0 0 0 / 0.4), 0 10px 30px -12px rgb(0 0 0 / 0.6); }
.hc-corners-sharp { --hc-radius: 0; --hc-control-radius: 0; }
.hc-corners-pill { --hc-radius: 22px; --hc-control-radius: 999px; }
/* Neutrals lean slightly toward the site's accent, so each site's greys belong to it. */
body {
  --hc-surface-tinted: color-mix(in oklab, var(--hc-accent) 5%, var(--hc-surface));
  --hc-border-tinted: color-mix(in oklab, var(--hc-accent) 9%, var(--hc-border));
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--hc-bg);
  color: var(--hc-text);
  font-family: var(--hc-font, system-ui, sans-serif);
  font-size: 1rem;
  line-height: 1.6;
  overflow-wrap: break-word;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
a { color: var(--hc-link); text-decoration-color: color-mix(in oklab, currentColor 40%, transparent); text-underline-offset: 0.2em; text-decoration-thickness: 1px; }
a:hover { text-decoration-color: currentColor; }
:focus-visible { outline: 2px solid var(--hc-link); outline-offset: 3px; border-radius: 4px; }
h1, h2, h3 { line-height: 1.2; margin: 0; letter-spacing: -0.015em; text-wrap: balance; }
h1 { letter-spacing: -0.025em; }
img { max-width: 100%; height: auto; }
.hc-sr-only {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.hc-skip {
  position: absolute; left: 0.5rem; top: -4rem; z-index: 10;
  padding: 0.5rem 0.75rem; border-radius: 6px;
  background: var(--hc-bg); color: var(--hc-text);
}
.hc-skip:focus { top: 0.5rem; }
.hc-wrap { width: 100%; max-width: 68rem; margin: 0 auto; padding: 0 1.25rem; }
.hc-narrow { max-width: 44rem; }

.hc-header { border-bottom: 1px solid var(--hc-border-tinted, var(--hc-border)); background: var(--hc-bg); }
.hc-header .hc-wrap {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 0.75rem 1.5rem; min-height: 4rem; padding-top: 0.6rem; padding-bottom: 0.6rem;
}
.hc-brand {
  display: inline-flex; align-items: center; gap: 0.65rem; min-width: 0;
  color: var(--hc-text); font-weight: 650; letter-spacing: -0.01em; text-decoration: none;
}
.hc-brand img { display: block; max-height: 2rem; max-width: 10rem; width: auto; }

/* One field: icon, input and a button that sits inside it. */
.hc-search {
  position: relative; display: flex; align-items: center; width: 100%; max-width: 36rem;
  border: 1px solid var(--hc-border-tinted, var(--hc-border)); border-radius: var(--hc-control-radius);
  background: var(--hc-bg); color: var(--hc-text);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.hc-search:focus-within { border-color: var(--hc-link); box-shadow: 0 0 0 3px color-mix(in oklab, var(--hc-link) 22%, transparent); }
.hc-search-icon { flex: none; width: 1.1rem; height: 1.1rem; margin-left: 0.9rem; color: var(--hc-muted); }
.hc-search input {
  flex: 1; min-width: 0; padding: 0.85rem 0.75rem; border: 0; border-radius: var(--hc-control-radius);
  background: transparent; color: inherit; font: inherit; outline: none;
}
.hc-search input::placeholder { color: var(--hc-muted); opacity: 1; }
.hc-search input::-webkit-search-cancel-button { display: none; }
.hc-search button {
  flex: none; margin: 0.3rem; padding: 0.55rem 1.05rem; border: 0;
  border-radius: calc(var(--hc-control-radius) - 3px);
  background: var(--hc-accent); color: var(--hc-on-accent);
  font: inherit; font-size: 0.95rem; font-weight: 600; cursor: pointer;
}
.hc-corners-pill .hc-search button { border-radius: 999px; }
.hc-search button:hover { filter: brightness(1.08); }
.hc-header .hc-search { max-width: 20rem; background: var(--hc-surface-tinted, var(--hc-surface)); border-color: transparent; }
.hc-header .hc-search input { padding: 0.5rem 0.6rem; font-size: 0.95rem; }
.hc-header .hc-search-icon { margin-left: 0.75rem; width: 1rem; height: 1rem; }
.hc-header .hc-search button { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); }

.hc-hero {
  position: relative; isolation: isolate; padding: clamp(3rem, 8vw, 5rem) 0 clamp(3rem, 7vw, 4.5rem);
  text-align: center; background: var(--hc-accent); color: var(--hc-on-accent);
}
.hc-hero h1 { max-width: 22ch; margin: 0 auto; font-size: clamp(2rem, 5.5vw, 3.1rem); font-weight: 700; }
.hc-hero p { margin: 0.9rem auto 0; max-width: 38rem; font-size: clamp(1.05rem, 2vw, 1.2rem); opacity: 0.88; }
.hc-hero .hc-search { margin: 2rem auto 0; border-color: transparent; box-shadow: var(--hc-shadow); }
.hc-hero :focus-visible { outline-color: currentColor; }
.hc-hero .hc-search :focus-visible { outline: none; }
.hc-hero-gradient {
  background: linear-gradient(var(--hc-hero-angle), var(--hc-hero-from), var(--hc-hero-to));
  color: var(--hc-on-gradient);
}
.hc-hero-image { padding: clamp(4rem, 10vw, 6.5rem) 0; background: #1a1d21; color: #ffffff; }
.hc-hero-image h1, .hc-hero-image p { text-shadow: 0 1px 12px rgb(0 0 0 / 0.35); }
.hc-hero-image::before {
  content: ""; position: absolute; inset: 0; z-index: -1;
  background: rgb(0 0 0 / var(--hc-hero-overlay));
}
.hc-hero-bg {
  position: absolute; inset: 0; z-index: -2;
  width: 100%; height: 100%; max-width: none; object-fit: cover;
}
.hc-hero-tint {
  background: var(--hc-surface);
  background: color-mix(in oklab, var(--hc-accent) 11%, var(--hc-bg));
  color: var(--hc-text);
}
.hc-hero-plain { padding-bottom: 1rem; background: var(--hc-bg); color: var(--hc-text); }
.hc-hero-plain .hc-search, .hc-hero-tint .hc-search { border-color: var(--hc-border-tinted, var(--hc-border)); }
.hc-hero-plain .hc-search { box-shadow: none; }
.hc-hero-tint p, .hc-hero-plain p { color: var(--hc-muted); opacity: 1; }
.hc-hero-left { text-align: left; }
.hc-hero-left h1, .hc-hero-left p, .hc-hero-left .hc-search { margin-left: 0; }

.hc-main { flex: 1; padding-top: 2.75rem; padding-bottom: 4.5rem; }
.hc-main h1 { font-size: clamp(1.75rem, 4.5vw, 2.4rem); font-weight: 700; margin-bottom: 0.6rem; }
.hc-lead { margin: 0 0 2rem; color: var(--hc-muted); font-size: 1.1rem; }

.hc-cards {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
  gap: 1rem; margin: 0; padding: 0; list-style: none;
}
.hc-card {
  display: flex; flex-direction: column; height: 100%; padding: 1.4rem 1.4rem 1.2rem;
  border: 1px solid var(--hc-border-tinted, var(--hc-border)); border-radius: var(--hc-radius);
  background: var(--hc-bg); color: var(--hc-text); text-decoration: none;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.hc-card:hover { border-color: color-mix(in oklab, var(--hc-link) 45%, var(--hc-border)); box-shadow: var(--hc-shadow); }
.hc-card-icon { display: block; font-size: 1.4rem; line-height: 1; margin-bottom: 1rem; }
.hc-card h2 { font-size: 1.075rem; font-weight: 650; }
.hc-card p { margin: 0.45rem 0 0; color: var(--hc-muted); font-size: 0.95rem; line-height: 1.5; }
.hc-card .hc-count {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  margin-top: auto; padding-top: 1.1rem; font-size: 0.85rem; font-variant-numeric: tabular-nums;
}
.hc-arrow { color: var(--hc-link); transition: transform 0.15s; }
.hc-card:hover .hc-arrow { transform: translateX(3px); }
@media (prefers-reduced-motion: reduce) { .hc-card, .hc-arrow, .hc-search { transition: none; } }

.hc-section { margin-top: 2.75rem; }
.hc-section:first-child { margin-top: 0; }
.hc-section h2 { font-size: 1.2rem; font-weight: 650; }
.hc-section h2 a { color: var(--hc-text); text-decoration: none; }
.hc-section h2 a:hover { text-decoration: underline; }
.hc-articles { margin: 0.9rem 0 0; padding: 0; list-style: none; border-top: 1px solid var(--hc-border-tinted, var(--hc-border)); }
.hc-articles li { border-bottom: 1px solid var(--hc-border-tinted, var(--hc-border)); }
.hc-articles a {
  display: block; padding: 0.85rem 2rem 0.85rem 0; position: relative;
  color: var(--hc-text); font-weight: 550; text-decoration: none;
}
.hc-articles a::after { content: "→"; position: absolute; right: 0.25rem; top: 0.85rem; color: var(--hc-muted); transition: transform 0.15s, color 0.15s; }
.hc-articles a:hover { color: var(--hc-link); }
.hc-articles a:hover::after { color: var(--hc-link); transform: translateX(3px); }
.hc-articles p { margin: -0.6rem 0 0; padding: 0 2rem 0.85rem 0; color: var(--hc-muted); font-size: 0.95rem; }

.hc-breadcrumb ol { display: flex; flex-wrap: wrap; gap: 0.45rem; margin: 0 0 1.5rem; padding: 0; list-style: none; font-size: 0.9rem; color: var(--hc-muted); }
.hc-breadcrumb a { color: var(--hc-muted); text-decoration: none; }
.hc-breadcrumb a:hover { color: var(--hc-text); text-decoration: underline; }
.hc-breadcrumb li + li::before { content: "/"; margin-right: 0.45rem; opacity: 0.6; }

.hc-prose { margin-top: 1.75rem; font-size: 1.0625rem; line-height: 1.75; }
.hc-prose h2, .hc-prose h3 { margin: 2.5rem 0 0.75rem; }
.hc-prose h2 { font-size: 1.4rem; font-weight: 650; }
.hc-prose h3 { font-size: 1.15rem; font-weight: 650; }
.hc-prose p, .hc-prose ul, .hc-prose ol, .hc-prose blockquote, .hc-prose pre { margin: 0 0 1.15rem; }
.hc-prose ul, .hc-prose ol { padding-left: 1.4rem; }
.hc-prose li + li { margin-top: 0.35rem; }
.hc-prose li::marker { color: var(--hc-muted); }
.hc-prose strong { font-weight: 650; }
.hc-prose img { display: block; margin: 1.75rem 0; border-radius: calc(var(--hc-radius) * 0.6); border: 1px solid var(--hc-border-tinted, var(--hc-border)); }
.hc-prose blockquote {
  padding: 0.9rem 1.1rem; border-left: 3px solid var(--hc-accent);
  border-radius: 0 calc(var(--hc-radius) * 0.6) calc(var(--hc-radius) * 0.6) 0;
  background: var(--hc-surface-tinted, var(--hc-surface)); color: var(--hc-text);
}
.hc-prose blockquote > :last-child { margin-bottom: 0; }
.hc-prose code { padding: 0.12em 0.4em; border-radius: 5px; background: var(--hc-surface-tinted, var(--hc-surface)); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.875em; }
.hc-prose pre { padding: 1rem 1.15rem; border: 1px solid var(--hc-border-tinted, var(--hc-border)); border-radius: calc(var(--hc-radius) * 0.6); background: var(--hc-surface-tinted, var(--hc-surface)); overflow-x: auto; font-size: 0.9rem; line-height: 1.6; }
.hc-prose pre code { padding: 0; background: none; }
.hc-prose hr { margin: 2.5rem 0; border: 0; border-top: 1px solid var(--hc-border-tinted, var(--hc-border)); }
.hc-prose table { width: 100%; border-collapse: collapse; margin: 0 0 1.15rem; font-size: 0.95rem; display: block; overflow-x: auto; }
.hc-prose th, .hc-prose td { padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--hc-border-tinted, var(--hc-border)); text-align: left; }

.hc-panel { margin-top: 3rem; padding: 1.25rem 1.4rem; border: 1px solid var(--hc-border-tinted, var(--hc-border)); border-radius: var(--hc-radius); background: var(--hc-surface-tinted, var(--hc-surface)); }
.hc-panel + .hc-panel { margin-top: 1rem; }
.hc-panel h2 { font-size: 1.05rem; font-weight: 650; }
.hc-panel p { margin: 0.35rem 0 0; color: var(--hc-muted); }
/* Feedback is a quiet row under the article, not a box. */
.hc-panel[data-hc-feedback] {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem 1.5rem;
  padding: 1.5rem 0 0; border: 0; border-top: 1px solid var(--hc-border-tinted, var(--hc-border));
  border-radius: 0; background: none;
}
.hc-panel[data-hc-feedback] h2 { font-size: 1rem; font-weight: 600; }
.hc-panel[data-hc-feedback] p { margin: 0; }
.hc-feedback-buttons { display: flex; gap: 0.5rem; }
.hc-feedback-buttons button {
  min-width: 4.5rem; padding: 0.45rem 1rem; border: 1px solid var(--hc-border-tinted, var(--hc-border));
  border-radius: var(--hc-control-radius);
  background: var(--hc-bg); color: var(--hc-text); font: inherit; font-size: 0.95rem; cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.hc-feedback-buttons button:hover { border-color: var(--hc-link); background: var(--hc-surface-tinted, var(--hc-surface)); }
[hidden] { display: none !important; }

.hc-footer { padding: 2rem 0 2.25rem; text-align: center; font-size: 0.8rem; }
.hc-footer a { color: var(--hc-muted); text-decoration: none; }
.hc-footer a:hover { color: var(--hc-text); }
`.trim();

const SITE_CSS_HASH = crypto.createHash("sha256").update(SITE_CSS).digest("hex").slice(0, 12);

/** Changes whenever the stylesheet does, so its response can be cached without limit. */
export const SITE_CSS_PATH = `/_hc/site.${SITE_CSS_HASH}.css`;
