import { describe, it, expect } from "@jest/globals";
import sharp from "sharp";
import {
  MAX_ANIMATION_FRAMES,
  MAX_IMAGE_INPUT_PIXELS,
  MediaRejectedError,
  sanitizeConversationMedia,
  neutraliseCsvFormulas,
  rasterizeSvgIcon,
} from "@server/services/media-sanitizer.service";

/**
 * Conversation media sanitising — real sharp and file-type, no mocks.
 */

const jpegWithGps = () =>
  sharp({ create: { width: 16, height: 12, channels: 3, background: "#c33" } })
    .jpeg()
    .withExif({
      IFD0: { Make: "TestCam", Model: "Phone" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 22/1 0/1" },
    })
    .toBuffer();

const png = () =>
  sharp({ create: { width: 4, height: 4, channels: 4, background: "#00f" } })
    .png()
    .toBuffer();

/** ISO-BMFF header with the given major brand. */
const ftyp = (brand: string) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from(`ftyp${brand}`, "latin1"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from(`${brand}isom`, "latin1"),
    Buffer.alloc(64),
  ]);

const oggOpus = () =>
  Buffer.concat([Buffer.from("OggS"), Buffer.alloc(24), Buffer.from("OpusHead"), Buffer.alloc(32)]);

/** Animated GIF; consecutive frames differ so the encoder can't merge them. */
const animatedGif = async (frames: number, size: number) => {
  const buffers = await Promise.all(
    Array.from({ length: frames }, (_, i) =>
      sharp({
        create: {
          width: size,
          height: size,
          channels: 3,
          background: i % 2 ? "#fff" : "#000",
        },
      })
        .png()
        .toBuffer(),
    ),
  );
  return sharp(buffers, { join: { animated: true } })
    .gif()
    .toBuffer();
};

const rejects = (buffer: Buffer, mimeType: string) =>
  expect(sanitizeConversationMedia(buffer, mimeType)).rejects.toBeInstanceOf(MediaRejectedError);

describe("sanitizeConversationMedia", () => {
  it("re-encodes JPEGs and strips EXIF including GPS", async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const result = await sanitizeConversationMedia(input, "image/jpeg");

    expect(result.mimeType).toBe("image/jpeg");
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.exif).toBeUndefined();
    expect(result.buffer.includes(Buffer.from("TestCam"))).toBe(false);
  });

  it("drops a payload appended to an image (polyglot)", async () => {
    const payload = Buffer.from("<script>alert(1)</script>");
    const result = await sanitizeConversationMedia(
      Buffer.concat([await png(), payload]),
      "image/png",
    );

    expect(result.mimeType).toBe("image/png");
    expect(result.buffer.includes(payload)).toBe(false);
  });

  it("uses the type from the content, not the declared one", async () => {
    const result = await sanitizeConversationMedia(await png(), "image/jpeg");

    expect(result.mimeType).toBe("image/png");
  });

  it("refuses SVG, archives, Office files and executables", async () => {
    await rejects(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "image/svg+xml");
    await rejects(
      Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(64)]),
      "application/zip",
    );
    await rejects(Buffer.from("d0cf11e0a1b11ae1" + "00".repeat(512), "hex"), "application/msword");
    await rejects(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(256)]), "application/pdf");
  });

  it("refuses HEIC/HEIF, which this sharp build cannot decode", async () => {
    await expect(sanitizeConversationMedia(ftyp("heic"), "image/heic")).rejects.toThrow(
      "HEIC/HEIF images are not supported",
    );
  });

  it("refuses unrecognised binary declared as an image", async () => {
    await rejects(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), "image/jpeg");
  });

  it("accepts .mov video unchanged", async () => {
    const input = ftyp("qt  ");
    const result = await sanitizeConversationMedia(input, "video/quicktime");

    expect(result).toEqual({ buffer: input, mimeType: "video/quicktime" });
  });

  it("keeps the declared audio type for an MP4-family container", async () => {
    const result = await sanitizeConversationMedia(ftyp("isom"), "audio/mp4");

    expect(result.mimeType).toBe("audio/mp4");
  });

  it("stores WhatsApp Opus voice notes as audio/ogg", async () => {
    const result = await sanitizeConversationMedia(oggOpus(), "audio/ogg; codecs=opus");

    expect(result.mimeType).toBe("audio/ogg");
  });

  it("accepts plain text only when no binary format is detected", async () => {
    const text = Buffer.from("order 1234, damaged on arrival\n");
    expect(await sanitizeConversationMedia(text, "text/plain")).toEqual({
      buffer: text,
      mimeType: "text/plain",
    });

    await rejects(text, "application/octet-stream");
  });

  it("keeps a small animated GIF animated", async () => {
    const result = await sanitizeConversationMedia(await animatedGif(3, 8), "image/gif");

    expect(result.mimeType).toBe("image/gif");
    expect((await sharp(result.buffer, { animated: true }).metadata()).pages).toBe(3);
  });

  it("refuses a small GIF whose frames decode past the pixel cap", async () => {
    const frames = Math.ceil(MAX_IMAGE_INPUT_PIXELS / (2000 * 2000)) + 1;
    const bomb = await animatedGif(frames, 2000);
    expect(bomb.length).toBeLessThan(200_000);

    await expect(sanitizeConversationMedia(bomb, "image/gif")).rejects.toThrow(
      /too large to process/,
    );
  });

  it("refuses an animation with too many frames", async () => {
    const gif = await animatedGif(MAX_ANIMATION_FRAMES + 1, 2);

    await expect(sanitizeConversationMedia(gif, "image/gif")).rejects.toThrow(/too many frames/);
  });
});

describe("neutraliseCsvFormulas", () => {
  const run = (input: string) => neutraliseCsvFormulas(Buffer.from(input)).toString();

  it("defuses formulas at the start of a cell, quoted or not", () => {
    expect(run('a,=1+1\n"@SUM(A1)",b\n')).toBe("a,'=1+1\n\"'@SUM(A1)\",b\n");
    expect(run('+cmd|x,"-2+3"')).toBe("'+cmd|x,\"'-2+3\"");
  });

  it("leaves numbers, inner characters and non-ASCII text alone", () => {
    expect(run('-12.5,+15551234567,a=b,"x,=y"\nação,-5%')).toBe(
      '-12.5,+15551234567,a=b,"x,=y"\nação,-5%',
    );
  });

  it("keeps a byte order mark and defuses the first cell after it", () => {
    expect(run("\ufeff=1,b")).toBe("\ufeff'=1,b");
  });

  it("applies to a .csv declared as plain text", async () => {
    const result = await sanitizeConversationMedia(Buffer.from("=1,b"), "text/plain", "x.CSV");
    expect(result.buffer.toString()).toBe("'=1,b");
  });
});

describe("rasterizeSvgIcon", () => {
  const svg = (body: string, head = "") =>
    Buffer.from(`${head}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`);

  it("renders an SVG to a square transparent PNG", async () => {
    const out = await rasterizeSvgIcon(
      svg('<path d="M3 3h18v18H3z" fill="#000"/>', '<?xml version="1.0"?>\n'),
    );
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ format: "png", width: 128, height: 128, hasAlpha: true });
  });

  it("keeps nothing of the SVG: scripts and links are gone", async () => {
    const out = await rasterizeSvgIcon(
      svg(
        '<script>alert(1)</script><a href="javascript:alert(1)"><circle cx="12" cy="12" r="9"/></a>',
      ),
    );
    expect(out.toString("latin1")).not.toMatch(/script|javascript/i);
  });

  it("rejects files that are not SVG, and oversized ones", async () => {
    await expect(rasterizeSvgIcon(await png())).rejects.toBeInstanceOf(MediaRejectedError);
    await expect(rasterizeSvgIcon(Buffer.from("<html><svg></svg></html>"))).rejects.toBeInstanceOf(
      MediaRejectedError,
    );
    const huge = svg(`<!--${"x".repeat(110 * 1024)}--><path d="M0 0h1v1z"/>`);
    await expect(rasterizeSvgIcon(huge)).rejects.toThrow(/under 100 KB/);
  });
});
