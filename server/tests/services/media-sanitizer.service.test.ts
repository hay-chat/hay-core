import { describe, it, expect } from "@jest/globals";
import sharp from "sharp";
import {
  MediaRejectedError,
  sanitizeConversationMedia,
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
});
