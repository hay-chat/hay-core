import { describe, expect, it, vi } from "vitest";
import { GraphApiError, GraphClient } from "./graph-client.js";
import { bareMimeType, ingestMedia, mediaFilename, MAX_MEDIA_BYTES } from "./media.js";
import type { ChannelContext } from "./context.js";
import type { WhatsAppConnection } from "./connection.js";
import { fakeLogger } from "./test/fakes.js";

const connection: WhatsAppConnection = {
  mode: "embedded-signup",
  accessToken: "biz-token",
  phoneNumberId: "976350592236691",
  wabaId: "1234567890",
};

const stored = {
  id: "up-1",
  name: "x",
  url: "https://cdn.hay.test/x",
  type: "image/jpeg",
  size: 3,
};

function setup(mime: string, upload: () => Promise<unknown> = async () => stored) {
  const graph = new GraphClient({
    logger: fakeLogger(),
    fetchImpl: vi.fn() as unknown as typeof fetch,
  });
  const getMedia = vi
    .spyOn(graph, "getMedia")
    .mockResolvedValue({ id: "m1", url: "https://lookaside.test/m1", mime_type: mime });
  const download = vi.spyOn(graph, "downloadMedia").mockResolvedValue(Buffer.from("abc"));
  const mutation = vi.fn((_procedure: string, _input: Record<string, unknown>) => upload());
  const ctx: ChannelContext = {
    getConnection: () => connection,
    graph,
    api: { mutation: mutation as unknown as ChannelContext["api"]["mutation"] },
    logger: fakeLogger(),
  };
  return { ctx, getMedia, download, mutation };
}

describe("mediaFilename", () => {
  it("keeps a document's own filename", () => {
    expect(mediaFilename("document", "m1", "application/pdf", "invoice.pdf")).toBe("invoice.pdf");
  });

  it.each([
    ["image/jpeg", "image-m1.jpg"],
    ["image/png", "image-m1.png"],
    ["video/3gpp", "image-m1.3gp"],
    ["audio/ogg", "image-m1.ogg"],
    ["audio/mp4", "image-m1.m4a"],
    ["application/zip", "image-m1.bin"],
  ])("derives the extension for %s", (mime, expected) => {
    expect(mediaFilename("image", "m1", mime)).toBe(expected);
  });
});

describe("bareMimeType", () => {
  it("strips parameters and lowercases", () => {
    expect(bareMimeType("Audio/OGG; codecs=opus")).toBe("audio/ogg");
  });
});

describe("ingestMedia", () => {
  it("downloads with the business token, capped at Hay's 10 MB upload limit, and uploads base64", async () => {
    const { ctx, getMedia, download, mutation } = setup("image/jpeg");

    const result = await ingestMedia({ type: "image", media: { id: "m1" }, connection, ctx });

    expect(result).toEqual({ attachment: stored });
    expect(getMedia).toHaveBeenCalledWith("m1", "biz-token");
    expect(download).toHaveBeenCalledWith(
      "https://lookaside.test/m1",
      "biz-token",
      MAX_MEDIA_BYTES,
    );
    expect(MAX_MEDIA_BYTES).toBe(10 * 1024 * 1024);
    expect(mutation).toHaveBeenCalledWith("media.upload", {
      data: Buffer.from("abc").toString("base64"),
      mimeType: "image/jpeg",
      filename: "image-m1.jpg",
      transcribe: false,
    });
  });

  it("sends voice notes bare-typed with transcribe and returns the transcript", async () => {
    const { ctx, mutation } = setup("audio/ogg; codecs=opus", async () => ({
      ...stored,
      type: "audio/ogg",
      transcript: "where is my parcel",
    }));

    const result = await ingestMedia({
      type: "audio",
      media: { id: "a1", voice: true },
      connection,
      ctx,
    });

    expect(result.transcript).toBe("where is my parcel");
    expect(result.attachment).toEqual({ ...stored, type: "audio/ogg" });
    expect(mutation.mock.calls[0][1]).toMatchObject({
      mimeType: "audio/ogg",
      filename: "audio-a1.ogg",
      transcribe: true,
    });
  });

  it("returns a failure when Meta rejects the media id", async () => {
    const { ctx, getMedia, mutation } = setup("image/jpeg");
    getMedia.mockRejectedValue(new GraphApiError("Media not found", 404));

    expect(await ingestMedia({ type: "image", media: { id: "gone" }, connection, ctx })).toEqual({
      failure: "Media not found",
    });
    expect(mutation).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it("returns a failure when the file is too large", async () => {
    const { ctx, download } = setup("video/mp4");
    download.mockRejectedValue(new GraphApiError("Media too large: 20000000 bytes", 413));

    expect(await ingestMedia({ type: "video", media: { id: "v1" }, connection, ctx })).toEqual({
      failure: "Media too large: 20000000 bytes",
    });
  });

  it("returns a failure when storage refuses the mime type", async () => {
    const { ctx } = setup("application/x-msdownload", async () => {
      throw new Error("Plugin API call failed: 400 File type not allowed");
    });

    const result = await ingestMedia({
      type: "document",
      media: { id: "d1", filename: "setup.exe" },
      connection,
      ctx,
    });

    expect(result).toEqual({ failure: "Plugin API call failed: 400 File type not allowed" });
  });
});
