import * as cheerio from "cheerio";
import sharp, { type Sharp } from "sharp";

/**
 * Pure helpers for the website branding import: which icon a site offers,
 * turning that icon into a PNG, and the colours it is made of. No network here
 * (see branding-import.service).
 */

export type IconKind = "svg" | "apple-touch" | "manifest" | "icon" | "favicon";

export interface IconCandidate {
  url: string;
  kind: IconKind;
  /** Largest declared edge in px; null when the page does not say. */
  size: number | null;
}

/** An icon is big enough for a logo from this edge size up. */
export const PREFERRED_ICON_SIZE = 96;
/** Icons this small or smaller are never used as a logo (only for colours). */
export const MAX_SKIPPED_ICON_SIZE = 32;
/** Edge of the stored logo PNG. */
const LOGO_EDGE = 256;

const TIER: Record<IconKind, number> = {
  svg: 0,
  "apple-touch": 1,
  manifest: 2,
  icon: 3,
  favicon: 4,
};

function absoluteHttpUrl(href: string | undefined, base: string): string | null {
  if (!href?.trim()) return null;
  try {
    const url = new URL(href.trim(), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** "16x16 192x192" → 192; "any" → null (callers treat SVGs as scalable). */
export function largestDeclaredSize(sizes: string | undefined): number | null {
  if (!sizes) return null;
  let largest: number | null = null;
  for (const token of sizes.toLowerCase().split(/\s+/)) {
    const match = /^(\d+)x(\d+)$/.exec(token);
    if (!match) continue;
    const edge = Math.min(Number(match[1]), Number(match[2]));
    if (largest === null || edge > largest) largest = edge;
  }
  return largest;
}

function isSvg(type: string | undefined, url: string): boolean {
  return (type ?? "").toLowerCase().includes("svg") || /\.svgz?$/i.test(new URL(url).pathname);
}

/**
 * Icon links and the web manifest URL in a page's HTML, plus `/favicon.ico`
 * as the last resort. Respects `<base href>`.
 */
export function parseIconLinks(
  html: string,
  pageUrl: string,
): { icons: IconCandidate[]; manifestUrl: string | null } {
  const $ = cheerio.load(html);
  const base = absoluteHttpUrl($("base[href]").first().attr("href"), pageUrl) ?? pageUrl;
  const icons: IconCandidate[] = [];
  let manifestUrl: string | null = null;

  $("link[rel][href]").each((_, element) => {
    const link = $(element);
    const rel = (link.attr("rel") ?? "").toLowerCase().split(/\s+/);
    const url = absoluteHttpUrl(link.attr("href"), base);
    if (!url) return;
    const size = largestDeclaredSize(link.attr("sizes"));

    if (rel.includes("manifest")) {
      manifestUrl ??= url;
    } else if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) {
      // Apple's default touch icon is 180px when no size is given.
      icons.push({ url, kind: "apple-touch", size: size ?? 180 });
    } else if (rel.includes("icon")) {
      const svg = isSvg(link.attr("type"), url);
      icons.push({ url, kind: svg ? "svg" : "icon", size });
    }
  });

  icons.push({ url: new URL("/favicon.ico", pageUrl).href, kind: "favicon", size: null });
  return { icons, manifestUrl };
}

/** Icons listed in a web app manifest (monochrome-only icons are skipped). */
export function parseManifestIcons(manifest: unknown, manifestUrl: string): IconCandidate[] {
  if (!manifest || typeof manifest !== "object") return [];
  const icons = (manifest as { icons?: unknown }).icons;
  if (!Array.isArray(icons)) return [];
  const candidates: IconCandidate[] = [];
  for (const icon of icons) {
    if (!icon || typeof icon !== "object") continue;
    const { src, sizes, type, purpose } = icon as Record<string, unknown>;
    if (typeof src !== "string") continue;
    if (typeof purpose === "string" && purpose.trim().toLowerCase() === "monochrome") continue;
    const url = absoluteHttpUrl(src, manifestUrl);
    if (!url) continue;
    const svg = isSvg(typeof type === "string" ? type : undefined, url);
    candidates.push({
      url,
      kind: svg ? "svg" : "manifest",
      size: largestDeclaredSize(typeof sizes === "string" ? sizes : undefined),
    });
  }
  return candidates;
}

function isPreferred(candidate: IconCandidate): boolean {
  return candidate.kind === "svg" || (candidate.size ?? 0) >= PREFERRED_ICON_SIZE;
}

/**
 * Order to try icons in: big-enough icons first (SVG, then apple-touch-icon,
 * then manifest, then other `<link rel=icon>`, largest first within a kind),
 * then the small or unsized ones, largest first, `/favicon.ico` last.
 */
export function rankIconCandidates(candidates: IconCandidate[]): IconCandidate[] {
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
  return unique.sort((a, b) => {
    const preferred = Number(isPreferred(b)) - Number(isPreferred(a));
    if (preferred !== 0) return preferred;
    if (isPreferred(a)) {
      return TIER[a.kind] - TIER[b.kind] || (b.size ?? 0) - (a.size ?? 0);
    }
    return (b.size ?? 0) - (a.size ?? 0) || TIER[a.kind] - TIER[b.kind];
  });
}

/* ================== Icon decoding ================== */

export interface DecodedIcon {
  /** PNG, at most LOGO_EDGE px on its longest edge. */
  png: Buffer;
  /** Edge of the source image (shortest side); SVGs count as LOGO_EDGE. */
  size: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RASTER_FORMATS = new Set(["png", "jpeg", "gif", "webp"]);
const MAX_INPUT_PIXELS = 4096 * 4096;

function looksLikeSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 1024).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
}

function isIco(buffer: Buffer): boolean {
  return buffer.length >= 6 && buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1;
}

/**
 * The largest image in an ICO file, as something sharp can read: embedded PNGs
 * as they are, 32-bit BMP entries as raw RGBA. Other BMP depths are skipped.
 */
export function readIco(
  buffer: Buffer,
): { png: Buffer } | { rgba: Buffer; width: number; height: number } | null {
  if (!isIco(buffer)) return null;
  const count = buffer.readUInt16LE(4);
  const entries: Array<{ width: number; size: number; offset: number }> = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    if (at + 16 > buffer.length) break;
    const width = buffer[at] || 256;
    const size = buffer.readUInt32LE(at + 8);
    const offset = buffer.readUInt32LE(at + 12);
    if (offset + size <= buffer.length && size > 0) entries.push({ width, size, offset });
  }
  entries.sort((a, b) => b.width - a.width);

  for (const entry of entries) {
    const data = buffer.subarray(entry.offset, entry.offset + entry.size);
    if (data.subarray(0, 8).equals(PNG_SIGNATURE)) return { png: data };
    const decoded = readIcoBmp(data);
    if (decoded) return decoded;
  }
  return null;
}

function readIcoBmp(data: Buffer): { rgba: Buffer; width: number; height: number } | null {
  if (data.length < 40) return null;
  const headerSize = data.readUInt32LE(0);
  const width = data.readInt32LE(4);
  const height = Math.abs(data.readInt32LE(8)) / 2; // XOR + AND masks
  const bitsPerPixel = data.readUInt16LE(14);
  const compression = data.readUInt32LE(16);
  if (bitsPerPixel !== 32 || compression !== 0 || width <= 0 || height <= 0 || width > 256) {
    return null;
  }
  const rowBytes = width * 4;
  if (headerSize + rowBytes * height > data.length) return null;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    // Rows are stored bottom-up, pixels as BGRA.
    const source = headerSize + (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x++) {
      const from = source + x * 4;
      const to = (y * width + x) * 4;
      rgba[to] = data[from + 2];
      rgba[to + 1] = data[from + 1];
      rgba[to + 2] = data[from];
      rgba[to + 3] = data[from + 3];
    }
  }
  return { rgba, width, height };
}

/**
 * Decode a downloaded icon (SVG, ICO, PNG, JPEG, GIF or WebP) into a PNG of at
 * most 256px. Null when the bytes are not an image we can read.
 */
export async function decodeIcon(buffer: Buffer): Promise<DecodedIcon | null> {
  try {
    if (looksLikeSvg(buffer)) {
      const png = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .resize(LOGO_EDGE, LOGO_EDGE, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      return { png, size: LOGO_EDGE };
    }

    let image: Sharp;
    if (isIco(buffer)) {
      const entry = readIco(buffer);
      if (!entry) return null;
      image =
        "png" in entry
          ? sharp(entry.png, { limitInputPixels: MAX_INPUT_PIXELS })
          : sharp(entry.rgba, { raw: { width: entry.width, height: entry.height, channels: 4 } });
    } else {
      image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, animated: false });
    }
    const { format, width, height } = await image.metadata();
    if (!format || !(RASTER_FORMATS.has(format) || format === "raw") || !width || !height) {
      return null;
    }

    const png = await image
      .resize(LOGO_EDGE, LOGO_EDGE, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return { png, size: Math.min(width, height) };
  } catch {
    return null;
  }
}

/* ================== Palette ================== */

interface Cluster {
  count: number;
  r: number;
  g: number;
  b: number;
}

/** Perceptual-ish RGB distance ("redmean"); ~0..765. */
function colorDistance(a: Cluster, b: Cluster): number {
  const meanR = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + meanR / 256) * dr * dr + 4 * dg * dg + (2 + (255 - meanR) / 256) * db * db);
}

/** Colours closer than this are one colour (anti-aliasing, gradients, JPEG noise). */
const MERGE_DISTANCE = 100;
/** A colour must cover at least this share of the icon's opaque pixels. */
const MIN_COVERAGE = 0.02;

function isNeutral(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (min > 230) return true; // near-white
  if (max < 40) return true; // near-black
  const chroma = max - min;
  const lightness = (max + min) / 2;
  const saturation = chroma / (255 - Math.abs(2 * lightness - 255) || 1);
  return chroma < 24 || saturation < 0.15; // greys
}

function toHex(cluster: Cluster): string {
  const channel = (value: number) => Math.round(value).toString(16).padStart(2, "0");
  return `#${channel(cluster.r)}${channel(cluster.g)}${channel(cluster.b)}`;
}

/**
 * Up to `max` brand colours from RGBA pixels, most coverage first. Transparent,
 * near-white, near-black and grey pixels are ignored; the rest are bucketed
 * (5 bits per channel), then buckets are merged into clusters by distance.
 */
export function extractPalette(rgba: Uint8Array, max = 3): string[] {
  const buckets = new Map<number, Cluster>();
  let opaque = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    opaque++;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    if (isNeutral(r, g, b)) continue;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }
  if (opaque === 0) return [];

  const clusters: Cluster[] = [];
  const byCount = [...buckets.values()]
    .map((bucket) => ({
      count: bucket.count,
      r: bucket.r / bucket.count,
      g: bucket.g / bucket.count,
      b: bucket.b / bucket.count,
    }))
    .sort((a, b) => b.count - a.count);
  for (const bucket of byCount) {
    const target = clusters.find((cluster) => colorDistance(cluster, bucket) < MERGE_DISTANCE);
    if (!target) {
      clusters.push({ ...bucket });
      continue;
    }
    // The cluster keeps its dominant colour's identity: weighted mean.
    const total = target.count + bucket.count;
    target.r = (target.r * target.count + bucket.r * bucket.count) / total;
    target.g = (target.g * target.count + bucket.g * bucket.count) / total;
    target.b = (target.b * target.count + bucket.b * bucket.count) / total;
    target.count = total;
  }

  const palette: Cluster[] = [];
  for (const cluster of clusters.sort((a, b) => b.count - a.count)) {
    if (cluster.count / opaque < MIN_COVERAGE) break;
    if (palette.some((kept) => colorDistance(kept, cluster) < MERGE_DISTANCE)) continue;
    palette.push(cluster);
    if (palette.length === max) break;
  }
  return palette.map(toHex);
}

/** Palette of a decoded icon PNG (downsampled to 64px). */
export async function paletteOfImage(png: Buffer): Promise<string[]> {
  const { data } = await sharp(png)
    .ensureAlpha()
    .resize(64, 64, { fit: "inside", kernel: "nearest" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return extractPalette(data);
}
