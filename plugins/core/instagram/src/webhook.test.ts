import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import { webhookHandler } from "./webhook.js";
import type { GraphClient } from "./graph-client.js";

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as HayLogger;

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("webhookHandler attachments (D8-6)", () => {
  it("forwards an attachment-only message instead of ignoring it", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith("https://cdn.test")) {
          return new Response("abc", { headers: { "content-type": "image/jpeg" } });
        }
        const body = JSON.parse(String(init?.body));
        calls.push({ url, body });
        const data = url.endsWith("media.upload")
          ? { id: "up-1", name: "image.jpg", url: "https://api.hay.test/v1/media/up-1", type: "image/jpeg", size: 3 }
          : { messageId: "m-1", conversationId: "c-1", processed: true };
        return new Response(JSON.stringify({ result: { data } }));
      }),
    );
    const graphClient = { getProfile: vi.fn(async () => ({ username: "shopper" })) } as unknown as GraphClient;
    const { response, out } = res();

    await webhookHandler(
      {
        headers: { "x-hay-webhook-verified": "true" },
        body: {
          entry: [
            {
              id: "ig-1",
              messaging: [
                {
                  sender: { id: "psid-1" },
                  message: { mid: "mid.1", attachments: [{ type: "image", payload: { url: "https://cdn.test/a" } }] },
                },
              ],
            },
          ],
        },
      } as unknown as Request,
      response,
      { getGraphClient: () => graphClient, getAccessToken: () => "token", logger },
    );

    expect(out.statusCode).toBe(200);
    expect(out.body).toMatchObject({ processed: 1, ignored: 0 });
    const receive = calls.find((call) => call.url.endsWith("messages.receive"));
    expect(receive?.body).toMatchObject({
      content: "[Customer sent a photo]",
      attachments: [{ id: "up-1", type: "image/jpeg" }],
      metadata: { mid: "mid.1", mediaPlaceholder: true },
    });
  });
});
