import { describe, expect, it, vi } from "vitest";
import type { HayLogger } from "@hay/plugin-sdk/types";
import { describeStored, ingestMessage, MAX_ATTACHMENT_BYTES, placeholderFor } from "./media.js";

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as HayLogger;

function response(bytes: string, contentType: string, status = 200): Response {
  return new Response(bytes, { status, headers: { "content-type": contentType } });
}

function setup(upload: (input: Record<string, unknown>) => unknown = () => ({})) {
  const mutation = vi.fn(async (_procedure: string, input: Record<string, unknown>) => ({
    id: "up-1",
    name: input.filename,
    url: "https://api.hay.test/v1/media/up-1",
    type: input.mimeType,
    size: 3,
    ...(upload(input) as object),
  }));
  return { api: { mutation: mutation as never }, mutation };
}

describe("ingestMessage", () => {
  it("stores a captionless photo and gives the agent a metadata line", async () => {
    const { api, mutation } = setup();
    const fetchImpl = vi.fn(async () => response("abc", "image/jpeg")) as unknown as typeof fetch;

    const result = await ingestMessage({
      text: "",
      attachments: [{ type: "image", payload: { url: "https://cdn.test/a" } }],
      mid: "mid.123",
      api,
      logger,
      fetchImpl,
    });

    expect(mutation).toHaveBeenCalledWith(
      "media.upload",
      expect.objectContaining({ mimeType: "image/jpeg", transcribe: false }),
    );
    expect(result.attachments).toHaveLength(1);
    expect(result.content).toBe("[Customer sent a photo]");
    expect(result.mediaPlaceholder).toBe(true);
  });

  it("keeps the shopper's text and stores every image", async () => {
    const { api } = setup();
    const fetchImpl = vi.fn(async () => response("abc", "image/png")) as unknown as typeof fetch;

    const result = await ingestMessage({
      text: "the cap is broken",
      attachments: [
        { type: "image", payload: { url: "https://cdn.test/a" } },
        { type: "image", payload: { url: "https://cdn.test/b" } },
      ],
      api,
      logger,
      fetchImpl,
    });

    expect(result.attachments).toHaveLength(2);
    expect(result.content).toBe("the cap is broken");
    expect(result.mediaPlaceholder).toBe(false);
  });

  it("transcribes a voice message and uses the transcript as the text", async () => {
    const { api, mutation } = setup(() => ({ transcript: "where is my order" }));
    const fetchImpl = vi.fn(async () => response("abc", "audio/mp4")) as unknown as typeof fetch;

    const result = await ingestMessage({
      text: "",
      attachments: [{ type: "audio", payload: { url: "https://cdn.test/a" } }],
      api,
      logger,
      fetchImpl,
    });

    expect(mutation.mock.calls[0][1]).toMatchObject({ transcribe: true });
    expect(result.content).toBe("where is my order");
    expect(result.voiceNote).toBe(true);
    expect(result.mediaPlaceholder).toBe(false);
  });

  it("never stores a sticker; it becomes a text line", async () => {
    const { api, mutation } = setup();
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await ingestMessage({
      text: "",
      attachments: [{ type: "image", payload: { url: "https://cdn.test/like", sticker_id: 369239263222822 } }],
      api,
      logger,
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
    expect(result.content).toBe("[Customer sent a sticker]");
    expect(result.attachments).toEqual([]);
  });

  it("falls back to a placeholder when a download fails or is too large", async () => {
    const { api, mutation } = setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response("", "video/mp4", 404))
      .mockResolvedValueOnce(
        new Response("x", {
          headers: { "content-type": "image/jpeg", "content-length": String(MAX_ATTACHMENT_BYTES + 1) },
        }),
      ) as unknown as typeof fetch;

    const result = await ingestMessage({
      text: "",
      attachments: [
        { type: "video", payload: { url: "https://cdn.test/v" } },
        { type: "image", payload: { url: "https://cdn.test/i" } },
      ],
      api,
      logger,
      fetchImpl,
    });

    expect(mutation).not.toHaveBeenCalled();
    expect(result.content).toBe(
      "[Customer sent a video that could not be loaded]\n[Customer sent a photo that could not be loaded]",
    );
    expect(result.failures.map((failure) => failure.type)).toEqual(["video", "image"]);
    expect(result.mediaPlaceholder).toBe(false);
  });
});

describe("placeholders", () => {
  it("names locations, links and unknown types", () => {
    expect(placeholderFor({ type: "location", payload: { title: "Our store" } })).toBe(
      "[Customer shared a location: Our store]",
    );
    expect(placeholderFor({ type: "fallback", payload: { title: "Blue shoe" } })).toBe(
      "[Customer shared a link: Blue shoe]",
    );
    expect(placeholderFor({ type: "template" })).toBe("[Customer shared a link]");
    expect(placeholderFor({ type: "product" })).toBe(
      "[Customer sent a Messenger attachment Hay.chat can't show]",
    );
    expect(placeholderFor({ type: "image" })).toBeNull();
  });

  it("counts stored attachments by type", () => {
    expect(describeStored(["image", "image", "file"])).toBe("[Customer sent 2 photos and a file]");
  });
});
