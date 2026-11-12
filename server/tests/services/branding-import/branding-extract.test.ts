import { describe, it, expect } from "@jest/globals";
import sharp from "sharp";
import {
  decodeIcon,
  extractPalette,
  largestDeclaredSize,
  paletteOfImage,
  parseIconLinks,
  parseManifestIcons,
  rankIconCandidates,
  readIco,
} from "@server/services/branding-import/branding-extract";

const PAGE = "https://shop.example.com/";

/** RGBA pixels: each [r, g, b, a] repeated `count` times. */
function pixels(...runs: Array<[number, number, number, number, number]>): Uint8Array {
  const out: number[] = [];
  for (const [r, g, b, a, count] of runs) {
    for (let i = 0; i < count; i++) out.push(r, g, b, a);
  }
  return Uint8Array.from(out);
}

async function solidPng(size: number, r: number, g: number, b: number): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r, g, b, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

/** An ICO file with one entry holding `data` (PNG bytes or a BMP DIB). */
function icoWith(data: Buffer, width: number): Buffer {
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = width >= 256 ? 0 : width;
  header[7] = width >= 256 ? 0 : width;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(data.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, data]);
}

/** A 32-bit BMP DIB as stored in ICO files (height doubled, rows bottom-up, BGRA). */
function bmpDib(width: number, rgba: [number, number, number, number]): Buffer {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(width * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  const body = Buffer.alloc(width * width * 4);
  for (let i = 0; i < width * width; i++) {
    body[i * 4] = rgba[2];
    body[i * 4 + 1] = rgba[1];
    body[i * 4 + 2] = rgba[0];
    body[i * 4 + 3] = rgba[3];
  }
  const andMask = Buffer.alloc(Math.ceil(width / 32) * 4 * width);
  return Buffer.concat([header, body, andMask]);
}

describe("largestDeclaredSize", () => {
  it("takes the largest WxH token", () => {
    expect(largestDeclaredSize("16x16 32x32 192x192")).toBe(192);
    expect(largestDeclaredSize("any")).toBeNull();
    expect(largestDeclaredSize(undefined)).toBeNull();
  });
});

describe("parseIconLinks", () => {
  const html = `<!doctype html><html><head>
    <link rel="shortcut icon" href="/favicon-32.png" sizes="32x32">
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="mask-icon" href="/safari-pinned.svg" color="#000">
    <link rel="icon" type="image/svg+xml" href="/logo.svg">
    <link rel="manifest" href="/site.webmanifest">
    <link rel="stylesheet" href="/style.css">
    <link rel="icon" href="javascript:alert(1)">
  </head><body></body></html>`;

  it("finds icon links, the manifest, and adds /favicon.ico", () => {
    const { icons, manifestUrl } = parseIconLinks(html, PAGE);
    expect(manifestUrl).toBe("https://shop.example.com/site.webmanifest");
    expect(icons).toEqual([
      { url: "https://shop.example.com/favicon-32.png", kind: "icon", size: 32 },
      { url: "https://shop.example.com/icons/icon-192.png", kind: "icon", size: 192 },
      { url: "https://shop.example.com/apple-touch-icon.png", kind: "apple-touch", size: 180 },
      { url: "https://shop.example.com/logo.svg", kind: "svg", size: null },
      { url: "https://shop.example.com/favicon.ico", kind: "favicon", size: null },
    ]);
  });

  it("resolves against <base href>", () => {
    const { icons } = parseIconLinks(
      `<head><base href="https://cdn.example.net/assets/"><link rel="icon" href="i.png"></head>`,
      PAGE,
    );
    expect(icons[0].url).toBe("https://cdn.example.net/assets/i.png");
  });
});

describe("parseManifestIcons", () => {
  it("lists icons with sizes and skips monochrome ones", () => {
    const manifest = {
      icons: [
        { src: "/android-192.png", sizes: "192x192", type: "image/png" },
        { src: "android-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        { src: "/mono.png", sizes: "512x512", purpose: "monochrome" },
        { sizes: "64x64" },
      ],
    };
    expect(parseManifestIcons(manifest, "https://shop.example.com/m/site.webmanifest")).toEqual([
      { url: "https://shop.example.com/android-192.png", kind: "manifest", size: 192 },
      { url: "https://shop.example.com/m/android-512.png", kind: "manifest", size: 512 },
    ]);
    expect(parseManifestIcons("nope", PAGE)).toEqual([]);
  });
});

describe("rankIconCandidates", () => {
  it("prefers SVG, then apple-touch-icon, then the largest manifest icon, then favicon.ico", () => {
    const ranked = rankIconCandidates([
      { url: "https://s/favicon.ico", kind: "favicon", size: null },
      { url: "https://s/m192.png", kind: "manifest", size: 192 },
      { url: "https://s/m512.png", kind: "manifest", size: 512 },
      { url: "https://s/apple.png", kind: "apple-touch", size: 180 },
      { url: "https://s/logo.svg", kind: "svg", size: null },
      { url: "https://s/i32.png", kind: "icon", size: 32 },
    ]);
    expect(ranked.map((icon) => icon.url)).toEqual([
      "https://s/logo.svg",
      "https://s/apple.png",
      "https://s/m512.png",
      "https://s/m192.png",
      "https://s/i32.png",
      "https://s/favicon.ico",
    ]);
  });

  it("puts a big icon of a later kind before a small one of an earlier kind", () => {
    const ranked = rankIconCandidates([
      { url: "https://s/apple-small.png", kind: "apple-touch", size: 57 },
      { url: "https://s/m256.png", kind: "manifest", size: 256 },
      { url: "https://s/m256.png", kind: "manifest", size: 256 },
    ]);
    expect(ranked.map((icon) => icon.url)).toEqual([
      "https://s/m256.png",
      "https://s/apple-small.png",
    ]);
  });
});

describe("extractPalette", () => {
  it("ranks colours by coverage and ignores transparent, white, black and grey", () => {
    const palette = extractPalette(
      pixels(
        [255, 255, 255, 255, 500], // white background
        [0, 0, 0, 255, 300], // black text
        [128, 128, 128, 255, 300], // grey
        [255, 0, 0, 0, 400], // transparent red: ignored
        [230, 57, 70, 255, 200], // red, most coverage
        [232, 60, 72, 255, 50], // near-identical red: same cluster
        [29, 53, 87, 255, 120], // navy
        [42, 157, 143, 255, 60], // teal
        [244, 162, 97, 255, 2], // too little coverage
      ),
    );
    expect(palette).toHaveLength(3);
    expect(palette[0]).toMatch(/^#e[67]3[89a-c]4[6-8]$/);
    expect(palette[1]).toBe("#1d3557");
    expect(palette[2]).toBe("#2a9d8f");
  });

  it("is empty for a monochrome icon", () => {
    expect(extractPalette(pixels([0, 0, 0, 255, 100], [255, 255, 255, 255, 100]))).toEqual([]);
    expect(extractPalette(new Uint8Array())).toEqual([]);
  });
});

describe("decodeIcon", () => {
  it("rasterizes an SVG to a 256px PNG and reads its colours", async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#7c3aed"/></svg>`,
    );
    const icon = await decodeIcon(svg);
    expect(icon?.size).toBe(256);
    const meta = await sharp(icon!.png).metadata();
    expect(meta.format).toBe("png");
    expect(await paletteOfImage(icon!.png)).toEqual(["#7c3aed"]);
  });

  it("reports the real size of raster icons and caps the PNG at 256px", async () => {
    const icon = await decodeIcon(await solidPng(512, 16, 185, 129));
    expect(icon?.size).toBe(512);
    expect((await sharp(icon!.png).metadata()).width).toBe(256);

    const small = await decodeIcon(await solidPng(32, 16, 185, 129));
    expect(small?.size).toBe(32);
  });

  it("reads PNG and 32-bit BMP entries of ICO files", async () => {
    const pngIco = icoWith(await solidPng(48, 0, 29, 245), 48);
    const fromPng = await decodeIcon(pngIco);
    expect(fromPng?.size).toBe(48);
    expect(await paletteOfImage(fromPng!.png)).toEqual(["#001df5"]);

    const bmpIco = icoWith(bmpDib(16, [230, 57, 70, 255]), 16);
    expect(readIco(bmpIco)).toMatchObject({ width: 16, height: 16 });
    const fromBmp = await decodeIcon(bmpIco);
    expect(fromBmp?.size).toBe(16);
    expect(await paletteOfImage(fromBmp!.png)).toEqual(["#e63946"]);
  });

  it("returns null for things that are not images", async () => {
    expect(await decodeIcon(Buffer.from("<html>not found</html>"))).toBeNull();
    expect(await decodeIcon(Buffer.from([0, 0, 1, 0, 0, 0]))).toBeNull();
  });
});
