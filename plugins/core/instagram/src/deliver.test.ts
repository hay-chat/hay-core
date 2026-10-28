import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import { deliverHandler, instagramAttachmentType } from "./deliver.js";
import { GraphApiError, type GraphClient } from "./graph-client.js";

/** D8-17: outbound files on Instagram (each its own DM, then the text). */

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as HayLogger;

function res() {
  const out = { statusCode: 0, body: undefined as unknown };
  const response = {
    status(code: number) {
      out.statusCode = code;
      return response;
    },
    json(body: unknown) {
      out.body = body;
      return response;
    },
  };
  return { response: response as unknown as Response, out };
}

function client(overrides: Partial<Record<"sendText" | "sendAttachment", unknown>> = {}) {
  let n = 0;
  return {
    sendText: vi.fn(async () => `mid.text.${++n}`),
    sendAttachment: vi.fn(async () => `mid.file.${++n}`),
    ...overrides,
  } as unknown as GraphClient & {
    sendText: ReturnType<typeof vi.fn>;
    sendAttachment: ReturnType<typeof vi.fn>;
  };
}

async function deliver(graph: GraphClient, body: Record<string, unknown>) {
  const { response, out } = res();
  await deliverHandler(
    { body: { to: "instagram:123", messageId: "m1", conversationId: "c1", ...body } } as Request,
    response,
    {
      getGraphClient: () => graph,
      getAccessToken: () => "token",
      logger,
    },
  );
  return out;
}

const photo = {
  name: "label.png",
  type: "image/png",
  url: "https://api.hay.test/v1/media/u1?expires=1&sig=a",
};

describe("Instagram outbound attachments", () => {
  it("maps MIME types to Instagram attachment types", () => {
    expect(instagramAttachmentType("image/jpeg")).toBe("image");
    expect(instagramAttachmentType("video/mp4")).toBe("video");
    expect(instagramAttachmentType("audio/mpeg")).toBe("audio");
    expect(instagramAttachmentType("application/pdf")).toBe("file");
    expect(instagramAttachmentType("application/zip")).toBeNull();
  });

  it("sends each file by its signed link, then the text", async () => {
    const graph = client();
    const out = await deliver(graph, { content: "Here is your label", attachments: [photo] });

    expect(graph.sendAttachment).toHaveBeenCalledWith(
      "123",
      { type: "image", url: photo.url },
      "token",
      "response",
    );
    expect(graph.sendText).toHaveBeenCalledWith("123", "Here is your label", "token", "response");
    expect(graph.sendAttachment.mock.invocationCallOrder[0]).toBeLessThan(
      graph.sendText.mock.invocationCallOrder[0],
    );
    expect(out).toEqual({
      statusCode: 200,
      body: { success: true, providerMessageId: "mid.text.2" },
    });
  });

  it("delivers a file-only message", async () => {
    const graph = client();
    const out = await deliver(graph, { content: "", attachments: [photo] });
    expect(graph.sendText).not.toHaveBeenCalled();
    expect(out.body).toEqual({ success: true, providerMessageId: "mid.file.1" });
  });

  it("refuses, without retry, a file-only message Instagram can't send", async () => {
    const graph = client();
    const out = await deliver(graph, {
      content: "",
      attachments: [{ name: "a.zip", type: "application/zip", url: "https://x.test/a.zip" }],
    });
    expect(out).toEqual({
      statusCode: 200,
      body: { success: false, error: "attachment_type_not_supported" },
    });
  });

  it("reports a partial delivery instead of a retry that would send the file twice", async () => {
    const graph = client({
      sendText: vi.fn(async () => {
        throw new GraphApiError("boom", 0);
      }),
    });
    const out = await deliver(graph, { content: "text", attachments: [photo] });
    expect(out).toEqual({
      statusCode: 200,
      body: { success: false, error: "partial_delivery", providerMessageId: "mid.file.1" },
    });
  });
});

describe("deliverHandler echo tracking (D11-11)", () => {
  it("remembers every mid it sent", async () => {
    const { SentMessageTracker } = await import("./echo.js");
    const tracker = new SentMessageTracker();
    const graph = client();
    const { response } = res();
    await deliverHandler(
      { body: { to: "instagram:123", messageId: "m1", conversationId: "c1", content: "hi", attachments: [photo] } } as Request,
      response,
      { getGraphClient: () => graph, getAccessToken: () => "token", logger, tracker },
    );
    expect(await tracker.isOwn("mid.file.1", "123")).toBe(true);
    expect(await tracker.isOwn("mid.text.2", "123")).toBe(true);
    expect(await tracker.isOwn("mid.other", "123")).toBe(false);
  });
});

describe("Human Agent tag after 24 hours (D13-14)", () => {
  const windowClosed = () => new GraphApiError("outside of allowed window", 400, 10, 2534022);

  it("resends a person's reply with the Human Agent tag when the window has closed", async () => {
    const graph = client({
      sendText: vi.fn(async (_to: string, _text: string, _token: string, mode: string) => {
        if (mode === "response") throw windowClosed();
        return "mid.tagged";
      }),
    });
    const out = await deliver(graph, { content: "Sorry for the wait", messageType: "HumanAgent" });
    expect(graph.sendText).toHaveBeenLastCalledWith("123", "Sorry for the wait", "token", "human_agent");
    expect(out.body).toEqual({ success: true, providerMessageId: "mid.tagged" });
  });

  it("never tags an AI reply", async () => {
    const graph = client({
      sendText: vi.fn(async () => {
        throw windowClosed();
      }),
    });
    const out = await deliver(graph, { content: "hi", messageType: "BotAgent" });
    expect(graph.sendText).toHaveBeenCalledTimes(1);
    expect(out.body).toEqual({ success: false, error: "24h_window_expired" });
  });

  it("reports the closed window when the tagged send is refused too", async () => {
    const graph = client({
      sendText: vi.fn(async () => {
        throw windowClosed();
      }),
    });
    const out = await deliver(graph, { content: "hi", messageType: "HumanAgent" });
    expect(graph.sendText).toHaveBeenCalledTimes(2);
    expect(out.body).toEqual({ success: false, error: "24h_window_expired" });
  });
});
