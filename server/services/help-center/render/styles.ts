/**
 * The site's stylesheet and the per-site theme variables.
 *
 * The stylesheet is the same for every help center, so it is served once
 * under a content-hashed address and cached for good. What differs per site
 * (accent colour, font) is a handful of CSS custom properties written into
 * each page.
 */
import crypto from "crypto";
import {
  DEFAULT_HELP_CENTER_THEME,
  type HelpCenterFont,
  type HelpCenterTheme,
} from "@server/database/entities/help-center.entity";
import { raw, type SafeHtml } from "./html";

/** System fonts only: a visitor's browser asks no third party for anything. */
const FONT_STACKS: Record<HelpCenterFont, string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif',
  rounded:
    'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

/** Page background and text per colour scheme; keep in step with the stylesheet below. */
const LIGHT = { background: "#ffffff", text: "#1a1d21" };
const DARK = { background: "#111418", text: "#e8ebee" };

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

/** Black or white, whichever reads better on the colour. */
export function readableTextOn(color: string): "#000000" | "#ffffff" {
  return contrastRatio(color, "#000000") >= contrastRatio(color, "#ffffff") ? "#000000" : "#ffffff";
}

/** The accent as a link colour when it is readable on the background, else the text colour. */
function linkColor(accent: string, scheme: { background: string; text: string }): string {
  return contrastRatio(accent, scheme.background) >= MIN_TEXT_CONTRAST ? accent : scheme.text;
}

/**
 * The contents of the page's theme `<style>`. The theme is stored JSON and,
 * in preview, comes from the query string, so nothing from it is trusted: the
 * colour must be `#rrggbb` and the font must be one of ours, or the default
 * is used. Nothing else from the theme reaches CSS.
 */
export function themeCss(theme: Pick<HelpCenterTheme, "accentColor" | "font">): SafeHtml {
  const accent = isHexColor(theme.accentColor)
    ? theme.accentColor.toLowerCase()
    : DEFAULT_HELP_CENTER_THEME.accentColor;
  const font = new Map(Object.entries(FONT_STACKS)).get(theme.font) ?? FONT_STACKS.sans;
  return raw(
    `:root{--hc-accent:${accent};--hc-on-accent:${readableTextOn(accent)};` +
      `--hc-link:${linkColor(accent, LIGHT)};--hc-font:${font}}` +
      `@media (prefers-color-scheme:dark){:root{--hc-link:${linkColor(accent, DARK)}}}`,
  );
}

export const SITE_CSS = `
:root {
  color-scheme: light dark;
  --hc-bg: ${LIGHT.background};
  --hc-surface: #f5f6f8;
  --hc-text: ${LIGHT.text};
  --hc-muted: #59626d;
  --hc-border: #dde1e6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --hc-bg: ${DARK.background};
    --hc-surface: #1a1f25;
    --hc-text: ${DARK.text};
    --hc-muted: #a4adb8;
    --hc-border: #2e353d;
  }
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
}
a { color: var(--hc-link); text-underline-offset: 0.15em; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 3px solid var(--hc-link); outline-offset: 2px; border-radius: 4px; }
h1, h2, h3 { line-height: 1.25; margin: 0; }
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
.hc-wrap { width: 100%; max-width: 60rem; margin: 0 auto; padding: 0 1rem; }
.hc-narrow { max-width: 46rem; }

.hc-header { border-bottom: 1px solid var(--hc-border); }
.hc-header .hc-wrap {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 0.75rem; padding-top: 0.75rem; padding-bottom: 0.75rem;
}
.hc-brand {
  display: inline-flex; align-items: center; gap: 0.6rem; min-width: 0;
  color: var(--hc-text); font-weight: 600; text-decoration: none;
}
.hc-brand img { display: block; max-height: 2rem; max-width: 10rem; width: auto; }

.hc-search { display: flex; width: 100%; max-width: 34rem; }
.hc-header .hc-search { max-width: 18rem; }
.hc-search input {
  flex: 1; min-width: 0; padding: 0.6rem 0.8rem;
  border: 1px solid var(--hc-border); border-right: 0; border-radius: 8px 0 0 8px;
  background: var(--hc-bg); color: var(--hc-text); font: inherit;
}
.hc-search button {
  padding: 0.6rem 1rem; border: 1px solid var(--hc-text); border-radius: 0 8px 8px 0;
  background: var(--hc-text); color: var(--hc-bg); font: inherit; font-weight: 600; cursor: pointer;
}
.hc-header .hc-search input, .hc-header .hc-search button { padding-top: 0.4rem; padding-bottom: 0.4rem; }

.hc-hero { background: var(--hc-accent); color: var(--hc-on-accent); padding: 3rem 0; text-align: center; }
.hc-hero h1 { font-size: clamp(1.6rem, 5vw, 2.4rem); }
.hc-hero p { margin: 0.75rem auto 0; max-width: 40rem; font-size: 1.1rem; }
.hc-hero .hc-search { margin: 1.5rem auto 0; }
.hc-hero .hc-search input { border-color: transparent; }
.hc-hero :focus-visible { outline-color: var(--hc-on-accent); }

.hc-main { flex: 1; padding-top: 2rem; padding-bottom: 3rem; }
.hc-main h1 { font-size: clamp(1.5rem, 4.5vw, 2.1rem); margin-bottom: 0.5rem; }
.hc-lead { margin: 0 0 1.5rem; color: var(--hc-muted); font-size: 1.05rem; }

.hc-cards {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
  gap: 1rem; margin: 0; padding: 0; list-style: none;
}
.hc-card {
  display: block; height: 100%; padding: 1.25rem;
  border: 1px solid var(--hc-border); border-radius: 12px;
  background: var(--hc-surface); color: var(--hc-text); text-decoration: none;
}
.hc-card:hover { border-color: var(--hc-link); }
.hc-card-icon { display: block; font-size: 1.75rem; line-height: 1; margin-bottom: 0.75rem; }
.hc-card h2 { font-size: 1.1rem; }
.hc-card p { margin: 0.4rem 0 0; color: var(--hc-muted); font-size: 0.95rem; }
.hc-card .hc-count { font-size: 0.85rem; }

.hc-section { margin-top: 2rem; }
.hc-section:first-child { margin-top: 0; }
.hc-section h2 { font-size: 1.25rem; }
.hc-section h2 a { color: var(--hc-text); text-decoration: none; }
.hc-section h2 a:hover { text-decoration: underline; }
.hc-articles { margin: 0.75rem 0 0; padding: 0; list-style: none; border-top: 1px solid var(--hc-border); }
.hc-articles li { padding: 0.75rem 0; border-bottom: 1px solid var(--hc-border); }
.hc-articles a { font-weight: 600; }
.hc-articles p { margin: 0.2rem 0 0; color: var(--hc-muted); font-size: 0.95rem; }

.hc-breadcrumb ol { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0 0 1.25rem; padding: 0; list-style: none; font-size: 0.9rem; color: var(--hc-muted); }
.hc-breadcrumb li + li::before { content: "/"; margin-right: 0.4rem; }

.hc-prose { margin-top: 1.5rem; font-size: 1.05rem; }
.hc-prose h1, .hc-prose h2, .hc-prose h3 { margin: 2rem 0 0.75rem; }
.hc-main .hc-prose h1 { font-size: 1.5rem; }
.hc-prose h2 { font-size: 1.3rem; }
.hc-prose h3 { font-size: 1.1rem; }
.hc-prose p, .hc-prose ul, .hc-prose ol, .hc-prose blockquote, .hc-prose pre { margin: 0 0 1rem; }
.hc-prose ul, .hc-prose ol { padding-left: 1.5rem; }
.hc-prose li + li { margin-top: 0.25rem; }
.hc-prose img { display: block; margin: 1.25rem 0; border-radius: 8px; }
.hc-prose blockquote { padding: 0.25rem 0 0.25rem 1rem; border-left: 4px solid var(--hc-border); color: var(--hc-muted); }
.hc-prose code { padding: 0.1em 0.35em; border-radius: 4px; background: var(--hc-surface); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
.hc-prose pre { padding: 1rem; border: 1px solid var(--hc-border); border-radius: 8px; background: var(--hc-surface); overflow-x: auto; }
.hc-prose pre code { padding: 0; background: none; }
.hc-prose hr { margin: 2rem 0; border: 0; border-top: 1px solid var(--hc-border); }

.hc-panel { margin-top: 2.5rem; padding: 1.25rem; border: 1px solid var(--hc-border); border-radius: 12px; background: var(--hc-surface); }
.hc-panel + .hc-panel { margin-top: 1rem; }
.hc-panel h2 { font-size: 1.05rem; }
.hc-panel p { margin: 0.4rem 0 0; }
.hc-feedback-buttons { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
.hc-feedback-buttons button {
  min-width: 4.5rem; padding: 0.5rem 1rem; border: 1px solid var(--hc-border); border-radius: 8px;
  background: var(--hc-bg); color: var(--hc-text); font: inherit; cursor: pointer;
}
.hc-feedback-buttons button:hover { border-color: var(--hc-link); }
[hidden] { display: none !important; }

.hc-footer { border-top: 1px solid var(--hc-border); padding: 1.25rem 0; text-align: center; font-size: 0.85rem; }
.hc-footer a { color: var(--hc-muted); }
`.trim();

const SITE_CSS_HASH = crypto.createHash("sha256").update(SITE_CSS).digest("hex").slice(0, 12);

/** Changes whenever the stylesheet does, so its response can be cached without limit. */
export const SITE_CSS_PATH = `/_hc/site.${SITE_CSS_HASH}.css`;
