import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import { deliverHandler, messengerAttachmentType } from "./deliver.js";
import { GraphApiError, type GraphClient } from "./graph-client.js";
import { PageRegistry } from "./pages.js";
import { SentMessageTracker } from "./echo.js";

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

async function connectedPages() {
  const pages = new PageRegistry();
  await pages.refresh(async () => [{ id: "page-1", name: "Store", accessToken: "page-token" }]);
  return pages;
}

async function deliver(
  graph: GraphClient,
  body: Record<string, unknown>,
  tracker?: SentMessageTracker,
) {
  const { response, out } = res();
  await deliverHandler(
    {
      body: { to: "messenger:page-1:psid-1", messageId: "m1", conversationId: "c1", ...body },
    } as Request,
    response,
    { getGraphClient: () => graph, pages: await connectedPages(), logger, tracker },
  );
  return out;
}

const photo = {
  name: "label.png",
  type: "image/png",
  url: "https://api.hay.test/v1/media/u1?expires=1&sig=a",
};

const windowClosed = () => new GraphApiError("outside of allowed window", 400, 10, 2018278);

describe("Messenger deliver", () => {
  it("maps MIME types to Messenger attachment types", () => {
    expect(messengerAttachmentType("image/jpeg")).toBe("image");
    expect(messengerAttachmentType("video/mp4")).toBe("video");
    expect(messengerAttachmentType("audio/mpeg")).toBe("audio");
    expect(messengerAttachmentType("application/pdf")).toBe("file");
    expect(messengerAttachmentType("application/zip")).toBeNull();
  });

  it("sends through the conversation's Page: each file, then the text", async () => {
    const graph = client();
    const out = await deliver(graph, { content: "Here is your label", attachments: [photo] });

    expect(graph.sendAttachment).toHaveBeenCalledWith(
      "psid-1",
      { type: "image", url: photo.url },
      "page-token",
      "response",
    );
    expect(graph.sendText).toHaveBeenCalledWith(
      "psid-1",
      "Here is your label",
      "page-token",
      "response",
    );
    expect(out).toEqual({
      statusCode: 200,
      body: { success: true, providerMessageId: "mid.text.2" },
    });
  });

  it("splits text longer than Messenger's 2000 characters", async () => {
    const graph = client();
    await deliver(graph, { content: `${"a".repeat(1500)}\n\n${"b".repeat(1500)}` });
    expect(graph.sendText).toHaveBeenCalledTimes(2);
    expect(graph.sendText.mock.calls[0][1]).toBe("a".repeat(1500));
    expect(graph.sendText.mock.calls[1][1]).toBe("b".repeat(1500));
  });

  it("refuses, without retry, a Page that is no longer connected", async () => {
    const graph = client();
    const out = await deliver(graph, { to: "messenger:page-2:psid-1", content: "hi" });
    expect(graph.sendText).not.toHaveBeenCalled();
    expect(out).toEqual({ statusCode: 200, body: { success: false, error: "page_not_connected" } });
  });

  it("refuses a recipient that is not a Messenger address", async () => {
    const out = await deliver(client(), { to: "instagram:123", content: "hi" });
    expect(out.body).toEqual({ success: false, error: "invalid_recipient" });
  });

  it("reports a partial delivery instead of a retry that would send the file twice", async () => {
    const graph = client({
      sendText: vi.fn(async () => {
        throw new GraphApiError("boom", 0);
      }),
    });
    const out = await deliver(graph, { content: "text", attachments: [photo] });
    expect(out.body).toEqual({
      success: false,
      error: "partial_delivery",
      providerMessageId: "mid.file.1",
    });
  });

  it("lets core retry a network error", async () => {
    const graph = client({
      sendText: vi.fn(async () => {
        throw new GraphApiError("Graph API network error: reset", 0);
      }),
    });
    const out = await deliver(graph, { content: "hi" });
    expect(out.statusCode).toBe(500);
  });

  it("remembers every mid it sent, for echo detection", async () => {
    const tracker = new SentMessageTracker();
    await deliver(client(), { content: "hi", attachments: [photo] }, tracker);
    expect(await tracker.isOwn("mid.file.1", "psid-1")).toBe(true);
    expect(await tracker.isOwn("mid.text.2", "psid-1")).toBe(true);
  });
});

describe("Messenger Human Agent tag after 24 hours", () => {
  it("resends a person's reply with the Human Agent tag when the window has closed", async () => {
    const graph = client({
      sendText: vi.fn(async (_to: string, _text: string, _token: string, mode: string) => {
        if (mode === "response") throw windowClosed();
        return "mid.tagged";
      }),
    });
    const out = await deliver(graph, { content: "Sorry for the wait", messageType: "HumanAgent" });
    expect(graph.sendText).toHaveBeenLastCalledWith(
      "psid-1",
      "Sorry for the wait",
      "page-token",
      "human_agent",
    );
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

  it("reports the closed window when the tagged send is refused too (after 7 days)", async () => {
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
