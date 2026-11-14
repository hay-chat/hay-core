// The brand-colour rule: any merchant colour becomes a header/bubble colour
// with readable text on it, plus an accent that reads as text on the surface.
// Pure functions, used by the loader to set the widget's colour tokens.

type Rgb = [number, number, number];

export const DEFAULT_BRAND_COLOR = "#001df5";
/** Text on a brand colour too light for white text. */
export const NEAR_BLACK = "#111827";
export const WHITE = "#ffffff";
/** The window surface in each theme; the accent must read on it. */
export const SURFACE = { light: "#ffffff", dark: "#161a22" } as const;

const MIN_TEXT = 4.5;
const MIN_NEAR_BLACK = 7;
const MIN_ICON = 3;
const STEP = 0.04;

/** "#abc" or "#aabbcc" (any case), or null when it is not a hex colour. */
export function normalizeHex(value: string | null | undefined): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value?.trim() ?? "");
  if (!match) return null;
  const hex = match[1].toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
}

function toRgb(hex: string): Rgb {
  const value = normalizeHex(hex) ?? DEFAULT_BRAND_COLOR;
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG contrast ratio between two hex colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(toRgb(a));
  const y = luminance(toRgb(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * `base` mixed towards `target` in 4% steps until it reaches `min` contrast
 * against `against` (or becomes `target`). Works on the rounded hex at each
 * step, so the returned colour itself meets the ratio.
 */
function mixUntil(base: string, target: string, against: string, min: number): string {
  const from = toRgb(base);
  const to = toRgb(target);
  let out = toHex(from);
  for (let step = 1; contrastRatio(out, against) < min && step * STEP <= 1 + 1e-9; step++) {
    const t = Math.min(1, step * STEP);
    out = toHex(from.map((v, i) => v + (to[i] - v) * t) as Rgb);
  }
  return out;
}

export interface BrandColors {
  /** Header, visitor bubbles and send button. */
  brand: string;
  /** Text and icons on `brand`. */
  onBrand: string;
}

/**
 * (1) white text reaches 4.5:1 → as is, white text. (2) near-black text
 * reaches 7:1 → as is, near-black text. (3) otherwise darken in 4% steps until
 * white text reaches 4.5:1.
 */
export function brandColors(input: string): BrandColors {
  const color = normalizeHex(input) ?? DEFAULT_BRAND_COLOR;
  if (contrastRatio(color, WHITE) >= MIN_TEXT) return { brand: color, onBrand: WHITE };
  if (contrastRatio(color, NEAR_BLACK) >= MIN_NEAR_BLACK) {
    return { brand: color, onBrand: NEAR_BLACK };
  }
  return { brand: mixUntil(color, "#000000", WHITE, MIN_TEXT), onBrand: WHITE };
}

/**
 * Brand-coloured text and outlines on the window surface: the brand mixed
 * towards black (light theme) or white (dark theme) until it reaches 4.5:1.
 */
export function accentColor(input: string, mode: "light" | "dark"): string {
  const { brand } = brandColors(input);
  return mixUntil(brand, mode === "dark" ? WHITE : "#000000", SURFACE[mode], MIN_TEXT);
}

/** The launcher keeps the exact merchant colour; its icon is white when that reaches 3:1. */
export function launcherIconColor(input: string): string {
  const color = normalizeHex(input) ?? DEFAULT_BRAND_COLOR;
  return contrastRatio(color, WHITE) >= MIN_ICON ? WHITE : NEAR_BLACK;
}

/** The CSS custom properties the widget's stylesheets read (see launcher.css). */
export function brandTokens(input: string | null | undefined): Record<string, string> {
  const launcher = normalizeHex(input) ?? DEFAULT_BRAND_COLOR;
  const { brand, onBrand } = brandColors(launcher);
  return {
    "--hay-brand": brand,
    "--hay-on-brand": onBrand,
    "--hay-accent-light": accentColor(launcher, "light"),
    "--hay-accent-dark": accentColor(launcher, "dark"),
    "--hay-launcher": launcher,
    "--hay-launcher-icon": launcherIconColor(launcher),
  };
}
