/**
 * Generates the placeholder product images for the Casa Aurora demo catalogue.
 *
 * Reads catalog/products.json and writes every file listed in each product's `images` to
 * catalog/images/ as a 1200×1200 PNG: flat-vector art of the object on a soft category colour,
 * the product name small at the bottom and a "DEMO" mark. Image 1 is the main shot; image 2 is a
 * closer "lifestyle" shot on a table surface, drawn in the second variant's colour when there is one.
 *
 * Run: /home/user/hay-core/node_modules/.bin/tsx tools/demo-account/scripts/generate-images.ts
 * SVG is rendered to PNG with Playwright's Chromium. If the repo's Playwright version has no matching
 * browser download, it falls back to the newest headless shell already in the browsers folder, so no
 * `playwright install` is needed.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { IMAGES_DIR, loadProducts, log } from "./lib/data";
import type { Category, Product } from "./lib/types";

const SIZE = 1200;

const CATEGORY_BG: Record<Category, string> = {
  candles: "#F3E6D8",
  "pots-and-vases": "#E2EADB",
  "cups-and-mugs": "#F2E1D9",
  "napkins-and-linen": "#E1E7EC",
  serving: "#EFE6CF",
};

/** Colour per variant option value; anything unknown falls back to the product's default. */
const OPTION_COLOUR: Record<string, string> = {
  Sandalwood: "#8B5E3C",
  Fig: "#7A3F63",
  "Orange Blossom": "#E39A3B",
  Eucalyptus: "#6E9A87",
  Terracotta: "#C46A45",
  Whitewash: "#ECE6DB",
  Medium: "#D9CDB5",
  Large: "#D9CDB5",
  White: "#F6F3EC",
  Sand: "#D8C3A0",
  "Sea Blue": "#5B8FA8",
  Clear: "#CFE3E6",
  Slate: "#5E6B73",
  Sage: "#9BAF8E",
  Natural: "#D9CBB2",
  Charcoal: "#4A4D52",
  "150 × 150 cm": "#E4D9C4",
  "150 × 250 cm": "#E4D9C4",
};

type Drawer = (colour: string) => string;

// ---------- small SVG helpers ----------

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 0xff;
    const next = amount < 0 ? c * (1 + amount) : c + (255 - c) * amount;
    return Math.round(Math.max(0, Math.min(255, next)));
  };
  return `#${[16, 8, 0].map((s) => channel(s).toString(16).padStart(2, "0")).join("")}`;
}

const shadow = (cx: number, cy: number, rx: number, ry = 26) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity="0.08"/>`;

const flame = (x: number, y: number) =>
  `<line x1="${x}" y1="${y}" x2="${x}" y2="${y - 26}" stroke="#3B2F2A" stroke-width="5" stroke-linecap="round"/>` +
  `<path d="M${x} ${y - 90} C ${x + 26} ${y - 55}, ${x + 20} ${y - 28}, ${x} ${y - 26} C ${x - 20} ${y - 28}, ${x - 26} ${y - 55}, ${x} ${y - 90} Z" fill="#F2A93B"/>` +
  `<path d="M${x} ${y - 66} C ${x + 11} ${y - 48}, ${x + 9} ${y - 32}, ${x} ${y - 30} C ${x - 9} ${y - 32}, ${x - 11} ${y - 48}, ${x} ${y - 66} Z" fill="#FCE3A2"/>`;

const leaf = (x: number, y: number, len: number, angle: number, colour = "#6F8F5E") =>
  `<ellipse cx="${x}" cy="${y - len / 2}" rx="${len * 0.22}" ry="${len / 2}" fill="${colour}" transform="rotate(${angle} ${x} ${y})"/>`;

function jar(x: number, base: number, w: number, h: number, glass: string, label: string, lit = true): string {
  const top = base - h;
  return (
    `<rect x="${x - w / 2}" y="${top}" width="${w}" height="${h}" rx="${w * 0.14}" fill="${glass}"/>` +
    `<rect x="${x - w / 2 + 14}" y="${top + 14}" width="${w - 28}" height="${h * 0.16}" rx="8" fill="#F5EAD7"/>` +
    `<rect x="${x - w / 2 + 18}" y="${top + 20}" width="12" height="${h * 0.6}" rx="6" fill="#fff" opacity="0.25"/>` +
    `<rect x="${x - w * 0.32}" y="${top + h * 0.42}" width="${w * 0.64}" height="${h * 0.32}" rx="6" fill="#F7F1E6"/>` +
    `<rect x="${x - w * 0.22}" y="${top + h * 0.52}" width="${w * 0.44}" height="${h * 0.05}" rx="4" fill="${label}"/>` +
    `<rect x="${x - w * 0.15}" y="${top + h * 0.62}" width="${w * 0.3}" height="${h * 0.03}" rx="3" fill="${label}" opacity="0.6"/>` +
    (lit ? flame(x, top + 18) : "")
  );
}

function potShape(x: number, base: number, wTop: number, wBottom: number, h: number, fill: string): string {
  const top = base - h;
  return (
    `<path d="M${x - wTop / 2} ${top + 30} L ${x + wTop / 2} ${top + 30} L ${x + wBottom / 2} ${base} L ${x - wBottom / 2} ${base} Z" fill="${fill}"/>` +
    `<rect x="${x - wTop / 2 - 16}" y="${top}" width="${wTop + 32}" height="44" rx="10" fill="${shade(fill, -0.08)}"/>`
  );
}

function mug(x: number, base: number, w: number, h: number, fill: string, steam = true): string {
  const top = base - h;
  return (
    `<path d="M${x + w / 2 - 10} ${top + h * 0.25} C ${x + w / 2 + 90} ${top + h * 0.2}, ${x + w / 2 + 90} ${top + h * 0.8}, ${x + w / 2 - 10} ${top + h * 0.75}" fill="none" stroke="${shade(fill, -0.12)}" stroke-width="${w * 0.11}" stroke-linecap="round"/>` +
    `<rect x="${x - w / 2}" y="${top}" width="${w}" height="${h}" rx="${w * 0.16}" fill="${fill}"/>` +
    `<rect x="${x - w / 2}" y="${top}" width="${w}" height="${h * 0.14}" rx="${w * 0.07}" fill="${shade(fill, -0.18)}"/>` +
    `<rect x="${x - w / 2 + 22}" y="${top + h * 0.25}" width="14" height="${h * 0.55}" rx="7" fill="#fff" opacity="0.18"/>` +
    (steam
      ? [-1, 0, 1]
          .map(
            (i) =>
              `<path d="M${x + i * 45} ${top - 30} c -22 -30, 22 -50, 0 -85" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity="0.7"/>`,
          )
          .join("")
      : "")
  );
}

function foldedCloth(x: number, base: number, w: number, layers: number, fill: string, pattern = ""): string {
  let out = "";
  for (let i = 0; i < layers; i++) {
    const y = base - (i + 1) * 46;
    const c = i % 2 === 0 ? fill : shade(fill, -0.06);
    out +=
      `<rect x="${x - w / 2 + i * 6}" y="${y}" width="${w}" height="56" rx="12" fill="${pattern || c}"/>` +
      `<line x1="${x - w / 2 + i * 6 + 24}" y1="${y + 10}" x2="${x + w / 2 + i * 6 - 24}" y2="${y + 10}" stroke="#fff" stroke-width="4" opacity="0.35"/>`;
  }
  return out;
}

function gingham(id: string): string {
  return (
    `<defs><pattern id="${id}" width="40" height="40" patternUnits="userSpaceOnUse">` +
    `<rect width="40" height="40" fill="#F7F1E6"/><rect width="20" height="40" fill="#C46A45" opacity="0.55"/>` +
    `<rect width="40" height="20" fill="#C46A45" opacity="0.55"/></pattern></defs>`
  );
}

// ---------- one drawer per product (keyed by handle) ----------

const DRAWERS: Record<string, Drawer> = {
  "aurora-soy-candle": (c) => shadow(600, 830, 200) + jar(600, 830, 300, 380, "#B5652B", c),
  "lavender-travel-tin": () =>
    shadow(600, 830, 240) +
    `<ellipse cx="780" cy="760" rx="120" ry="40" fill="#A9A7B0" transform="rotate(-18 780 760)"/>` +
    `<rect x="380" y="690" width="300" height="140" rx="20" fill="#B9B7C0"/>` +
    `<ellipse cx="530" cy="690" rx="150" ry="36" fill="#EFE6F3"/>` +
    `<rect x="440" y="740" width="180" height="50" rx="8" fill="#8E7AA8"/>` +
    flame(530, 692),
  "candle-trio-gift-set": () =>
    shadow(600, 840, 330) +
    `<rect x="320" y="560" width="560" height="280" rx="16" fill="#C8A57E"/>` +
    `<rect x="320" y="560" width="560" height="40" rx="12" fill="#B48F67"/>` +
    jar(430, 830, 160, 190, "#E8E2D6", OPTION_COLOUR.Sandalwood) +
    jar(600, 830, 160, 190, "#E8E2D6", OPTION_COLOUR.Fig) +
    jar(770, 830, 160, 190, "#E8E2D6", OPTION_COLOUR["Orange Blossom"]),
  "terra-three-wick-candle": () =>
    shadow(600, 830, 300) +
    `<path d="M330 640 L 870 640 C 860 760, 760 830, 600 830 C 440 830, 340 760, 330 640 Z" fill="#9C7A5B"/>` +
    `<ellipse cx="600" cy="640" rx="270" ry="50" fill="#F2E4CC"/>` +
    flame(500, 640) +
    flame(600, 625) +
    flame(700, 640),
  "brass-wick-trimmer": () =>
    shadow(600, 840, 260, 18) +
    `<g transform="rotate(-30 600 600)">` +
    `<rect x="585" y="300" width="14" height="440" rx="7" fill="#C9A541"/>` +
    `<rect x="603" y="300" width="14" height="440" rx="7" fill="#B38F31"/>` +
    `<rect x="560" y="280" width="80" height="40" rx="10" fill="#C9A541"/>` +
    `<circle cx="560" cy="790" r="48" fill="none" stroke="#C9A541" stroke-width="16"/>` +
    `<circle cx="650" cy="790" r="48" fill="none" stroke="#B38F31" stroke-width="16"/></g>`,
  "terracotta-plant-pot": (c) =>
    shadow(600, 840, 250) +
    leaf(600, 520, 260, -30) +
    leaf(600, 520, 300, 5, "#7E9F6B") +
    leaf(600, 520, 240, 38) +
    `<ellipse cx="600" cy="835" rx="230" ry="30" fill="${shade(c, -0.15)}"/>` +
    potShape(600, 820, 380, 280, 330, c),
  "stoneware-planter": (c) =>
    shadow(600, 850, 300) +
    leaf(600, 470, 340, -42, "#5E7F4F") +
    leaf(600, 470, 380, -8) +
    leaf(600, 470, 330, 30, "#7E9F6B") +
    leaf(600, 470, 280, 60, "#5E7F4F") +
    potShape(600, 850, 480, 380, 420, c) +
    Array.from({ length: 40 }, (_, i) => {
      const rand = (seed: number) => Math.abs(Math.sin(seed) * 43758.5453) % 1; // deterministic scatter
      const [x, y] = [440 + rand(i * 12.9898) * 320, 520 + rand(i * 78.233) * 290];
      return `<circle cx="${x}" cy="${y}" r="5" fill="#6B5B4B" opacity="0.5"/>`;
    }).join(""),
  "mini-succulent-pots": () =>
    shadow(600, 840, 330) +
    [
      [400, 150, "#9BAF8E"],
      [600, 180, "#D8C3A0"],
      [800, 160, "#B8775A"],
    ]
      .map(
        ([x, h, col]) =>
          leaf(x as number, 840 - (h as number) + 20, 90, -40, "#7E9F6B") +
          leaf(x as number, 840 - (h as number) + 20, 110, 0, "#6F8F5E") +
          leaf(x as number, 840 - (h as number) + 20, 90, 40, "#7E9F6B") +
          potShape(x as number, 840, 160, 120, h as number, col as string),
      )
      .join(""),
  "arco-bud-vase": (c) =>
    shadow(600, 840, 200) +
    `<path d="M600 300 C 610 380, 610 460, 600 540" stroke="#6F8F5E" stroke-width="8" fill="none"/>` +
    `<circle cx="600" cy="290" r="34" fill="#E9A38C"/><circle cx="600" cy="290" r="14" fill="#F3C9A7"/>` +
    leaf(604, 430, 80, 50) +
    `<rect x="560" y="500" width="80" height="120" rx="20" fill="${shade(c, -0.05)}"/>` +
    `<ellipse cx="600" cy="710" rx="190" ry="140" fill="${c}"/>` +
    `<ellipse cx="600" cy="500" rx="46" ry="12" fill="${shade(c, -0.2)}"/>`,
  "mar-glass-vase": (c) =>
    shadow(600, 860, 180) +
    `<path d="M560 200 C 570 300, 580 380, 590 430" stroke="#6F8F5E" stroke-width="8" fill="none"/>` +
    `<path d="M640 230 C 630 320, 620 380, 610 430" stroke="#6F8F5E" stroke-width="8" fill="none"/>` +
    leaf(560, 260, 110, -35) +
    leaf(640, 290, 110, 35, "#7E9F6B") +
    `<rect x="480" y="400" width="240" height="460" rx="70" fill="${c}" opacity="0.75"/>` +
    `<rect x="510" y="440" width="22" height="360" rx="11" fill="#fff" opacity="0.4"/>` +
    `<circle cx="640" cy="560" r="8" fill="#fff" opacity="0.5"/><circle cx="660" cy="700" r="6" fill="#fff" opacity="0.5"/>` +
    `<ellipse cx="600" cy="405" rx="110" ry="18" fill="${shade(c, -0.2)}" opacity="0.8"/>`,
  "stoneware-mug": (c) => shadow(580, 830, 220) + mug(560, 830, 300, 320, c),
  "stoneware-mug-set-of-4": () =>
    shadow(600, 850, 380) +
    mug(420, 760, 190, 210, OPTION_COLOUR.Sand, false) +
    mug(720, 760, 190, 210, OPTION_COLOUR.Slate, false) +
    mug(330, 850, 190, 210, OPTION_COLOUR.Sage, false) +
    mug(630, 850, 190, 210, "#B8775A", false),
  "gold-rim-espresso-cups": () =>
    shadow(600, 840, 380) +
    [420, 780]
      .map(
        (x) =>
          `<ellipse cx="${x}" cy="820" rx="150" ry="34" fill="#F4F1EA"/>` +
          `<ellipse cx="${x}" cy="814" rx="150" ry="30" fill="none" stroke="#C9A541" stroke-width="6"/>` +
          `<path d="M${x + 70} 700 C ${x + 140} 700, ${x + 140} 780, ${x + 60} 780" fill="none" stroke="#EDE8DE" stroke-width="18"/>` +
          `<path d="M${x - 95} 660 L ${x + 95} 660 C ${x + 90} 760, ${x + 60} 805, ${x} 805 C ${x - 60} 805, ${x - 90} 760, ${x - 95} 660 Z" fill="#FBF9F4"/>` +
          `<rect x="${x - 98}" y="652" width="196" height="12" rx="6" fill="#C9A541"/>`,
      )
      .join(""),
  "lua-stoneware-tumbler": (c) =>
    shadow(600, 840, 190) +
    `<path d="M460 450 L 740 450 L 715 830 L 485 830 Z" fill="${c}"/>` +
    `<rect x="485" y="790" width="230" height="40" rx="6" fill="#C9AE8A"/>` +
    `<rect x="456" y="440" width="288" height="36" rx="12" fill="${shade(c, -0.15)}"/>` +
    `<rect x="500" y="500" width="16" height="250" rx="8" fill="#fff" opacity="0.18"/>`,
  "linen-napkins-set-of-4": (c) => shadow(600, 850, 300) + foldedCloth(600, 850, 480, 4, c),
  "gingham-cotton-napkins": () =>
    gingham("ging") +
    shadow(600, 850, 300) +
    foldedCloth(600, 850, 480, 3, "#9BAF8E") +
    `<rect x="380" y="620" width="480" height="70" rx="12" fill="url(#ging)"/>`,
  "linen-tablecloth": (c) =>
    shadow(600, 860, 340) +
    `<path d="M300 460 L 900 460 L 940 860 L 260 860 Z" fill="${c}"/>` +
    `<path d="M300 460 L 900 460 L 880 540 L 320 540 Z" fill="${shade(c, -0.08)}"/>` +
    [400, 520, 640, 760].map((x) => `<line x1="${x}" y1="560" x2="${x - 20 + (x - 600) * 0.12}" y2="850" stroke="#fff" stroke-width="5" opacity="0.3"/>`).join(""),
  "linen-table-runner": (c) =>
    shadow(600, 820, 420, 20) +
    `<path d="M240 700 L 900 560 L 960 640 L 300 790 Z" fill="${c}"/>` +
    Array.from({ length: 9 }, (_, i) => {
      const t = i / 8;
      const x = 240 + t * 60;
      const y = 700 + t * 90;
      return `<line x1="${x}" y1="${y}" x2="${x - 30}" y2="${y + 6}" stroke="${shade(c, -0.15)}" stroke-width="5" stroke-linecap="round"/>`;
    }).join(""),
  "oak-serving-tray": () =>
    shadow(600, 820, 400, 30) +
    `<path d="M220 600 L 980 600 L 940 800 L 260 800 Z" fill="#B88A5A"/>` +
    `<path d="M260 620 L 940 620 L 910 780 L 290 780 Z" fill="#D2A876"/>` +
    `<rect x="300" y="650" width="70" height="20" rx="10" fill="#8F6A42"/><rect x="830" y="650" width="70" height="20" rx="10" fill="#8F6A42"/>` +
    [660, 700, 740].map((y) => `<path d="M380 ${y} C 500 ${y - 12}, 700 ${y + 12}, 820 ${y}" stroke="#B88A5A" stroke-width="4" fill="none" opacity="0.6"/>`).join(""),
  "stoneware-serving-bowl": () =>
    shadow(600, 830, 340) +
    `<path d="M240 590 L 960 590 C 940 760, 800 830, 600 830 C 400 830, 260 760, 240 590 Z" fill="#F6F3EC"/>` +
    `<ellipse cx="600" cy="590" rx="360" ry="70" fill="#E9E2D4"/>` +
    `<ellipse cx="600" cy="590" rx="360" ry="70" fill="none" stroke="#A97C57" stroke-width="10"/>` +
    leaf(520, 600, 120, -60, "#7E9F6B") +
    leaf(640, 600, 130, 50) +
    `<circle cx="590" cy="570" r="26" fill="#D9553F"/>`,
  "stoneware-pitcher": () =>
    shadow(600, 850, 200) +
    `<path d="M700 420 C 820 430, 830 620, 700 660" fill="none" stroke="#C4AD88" stroke-width="34" stroke-linecap="round"/>` +
    `<path d="M480 380 L 720 380 L 700 470 C 760 560, 740 800, 690 850 L 510 850 C 460 800, 440 560, 500 470 Z" fill="${OPTION_COLOUR.Sand}"/>` +
    `<path d="M470 380 L 440 340 L 520 370 Z" fill="${OPTION_COLOUR.Sand}"/>` +
    `<rect x="466" y="368" width="264" height="26" rx="10" fill="#C4AD88"/>`,
  "olive-wood-salad-servers": () =>
    shadow(600, 840, 300, 20) +
    `<g transform="rotate(-12 600 600)"><rect x="480" y="300" width="34" height="380" rx="17" fill="#A88358"/>` +
    `<ellipse cx="497" cy="740" rx="70" ry="110" fill="#B8915F"/><ellipse cx="497" cy="740" rx="48" ry="84" fill="#9C7650"/></g>` +
    `<g transform="rotate(12 600 600)"><rect x="686" y="300" width="34" height="380" rx="17" fill="#A88358"/>` +
    `<path d="M633 660 L 773 660 L 763 850 L 643 850 Z" fill="#B8915F"/>` +
    [665, 703, 741].map((x) => `<rect x="${x}" y="720" width="14" height="140" fill="${CATEGORY_BG.serving}"/>`).join("") +
    `</g>`,
};

// ---------- composition ----------

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function render(product: Product, index: number): string {
  const drawer = DRAWERS[product.handle];
  if (!drawer) throw new Error(`No drawing for "${product.handle}". Add one to DRAWERS in generate-images.ts.`);
  const bg = CATEGORY_BG[product.category];
  const variant = product.variants[index === 0 ? 0 : Math.min(1, product.variants.length - 1)];
  const colour = OPTION_COLOUR[variant.options[0] ?? ""] ?? "#C46A45";
  const object = drawer(colour);

  const scene =
    index === 0
      ? `<rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>` +
        `<circle cx="600" cy="600" r="420" fill="#fff" opacity="0.35"/>` +
        object
      : // Lifestyle: deeper background, a table edge, a sun disc and the object a little closer.
        `<rect width="${SIZE}" height="${SIZE}" fill="${shade(bg, -0.07)}"/>` +
        `<circle cx="930" cy="250" r="130" fill="#fff" opacity="0.4"/>` +
        `<rect y="820" width="${SIZE}" height="${SIZE - 820}" fill="${shade(bg, -0.2)}"/>` +
        `<rect y="820" width="${SIZE}" height="14" fill="${shade(bg, -0.28)}"/>` +
        `<g transform="translate(600 820) scale(1.15) translate(-600 -830)">${object}</g>`;

  const name = escapeXml(product.title.en);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    scene +
    `<text x="600" y="1130" text-anchor="middle" font-family="Inter, DejaVu Sans, sans-serif" font-size="34" font-weight="500" fill="#3B2F2A" opacity="0.7">${name}</text>` +
    `<g opacity="0.35"><rect x="1030" y="44" width="126" height="44" rx="22" fill="none" stroke="#3B2F2A" stroke-width="2"/>` +
    `<text x="1093" y="74" text-anchor="middle" font-family="Inter, DejaVu Sans, sans-serif" font-size="20" font-weight="600" letter-spacing="4" fill="#3B2F2A">DEMO</text></g>` +
    `<text x="56" y="76" font-family="Inter, DejaVu Sans, sans-serif" font-size="22" font-weight="600" letter-spacing="3" fill="#3B2F2A" opacity="0.35">CASA AURORA</text>` +
    `</svg>`
  );
}

/** chromium.launch(), or the newest installed headless shell when this Playwright's own build is missing. */
async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (error) {
    if (!String(error).includes("Executable doesn't exist")) throw error;
    const browsersDir = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), ".cache", "ms-playwright");
    const shells = existsSync(browsersDir)
      ? readdirSync(browsersDir)
          .filter((name) => name.startsWith("chromium_headless_shell-"))
          .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : [];
    for (const dir of shells) {
      const executablePath = join(browsersDir, dir, "chrome-headless-shell-linux64", "chrome-headless-shell");
      if (existsSync(executablePath)) {
        log(`Playwright's bundled Chromium is missing; using ${executablePath}`);
        return chromium.launch({ executablePath });
      }
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const products = loadProducts();
  mkdirSync(IMAGES_DIR, { recursive: true });
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  let count = 0;
  let bytes = 0;
  try {
    for (const product of products) {
      for (const [index, file] of product.images.entries()) {
        await page.setContent(`<!doctype html><html><body style="margin:0">${render(product, index)}</body></html>`);
        const path = join(IMAGES_DIR, file);
        await page.screenshot({ path, type: "png", clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
        const size = statSync(path).size;
        count += 1;
        bytes += size;
        log(`  ${file} (${Math.round(size / 1024)} KB)`);
      }
    }
  } finally {
    await browser.close();
  }
  log(`Wrote ${count} images, ${Math.round(bytes / 1024)} KB total, to ${IMAGES_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
