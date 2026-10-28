import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import { webhookHandler } from "./webhook.js";
import type { GraphClient } from "./graph-client.js";
import { SentMessageTracker } from "./echo.js";

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

describe("webhookHandler echoes (D11-11)", () => {
  function stubApi(result: Record<string, unknown> = { messageId: "m-1", conversationId: "c-1" }) {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ result: { data: result } }));
      }),
    );
    return calls;
  }

  async function echo(message: Record<string, unknown>, extra: Partial<Parameters<typeof webhookHandler>[2]> = {}) {
    const graphClient = { getProfile: vi.fn() } as unknown as GraphClient;
    const { response, out } = res();
    await webhookHandler(
      {
        headers: { "x-hay-webhook-verified": "true" },
        body: {
          entry: [
            {
              id: "ig-1",
              messaging: [
                { sender: { id: "ig-1" }, recipient: { id: "psid-9" }, message: { is_echo: true, ...message } },
              ],
            },
          ],
        },
      } as unknown as Request,
      response,
      { getGraphClient: () => graphClient, getAccessToken: () => "token", logger, ...extra },
    );
    return out;
  }

  it("stores the owner's Instagram app reply as a human message for the shopper", async () => {
    const calls = stubApi();
    const out = await echo({ mid: "mid.owner", text: "Hi! It ships today" });

    expect(out.body).toMatchObject({ processed: 1, ignored: 0 });
    expect(calls[0].body).toMatchObject({
      from: "instagram:psid-9",
      content: "Hi! It ships today",
      channel: "instagram",
      senderType: "human_agent",
      metadata: { mid: "mid.owner", echo: true },
    });
  });

  it("drops echoes that carry Hay.chat's app id", async () => {
    const calls = stubApi();
    const out = await echo({ mid: "mid.x", text: "AI reply", app_id: 4242 }, { ownAppIds: ["4242"] });
    expect(out.body).toMatchObject({ processed: 0, ignored: 1 });
    expect(calls).toHaveLength(0);
  });

  it("drops echoes of a mid this worker sent, even while the send is still in flight", async () => {
    const calls = stubApi();
    const tracker = new SentMessageTracker();
    let finish: () => void = () => undefined;
    const sending = tracker.track("psid-9", async () => {
      await new Promise<void>((resolve) => (finish = resolve));
      tracker.remember("mid.ours");
    });

    const pending = echo({ mid: "mid.ours", text: "AI reply" }, { tracker });
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish();
    await sending;
    const out = await pending;

    expect(out.body).toMatchObject({ processed: 0, ignored: 1 });
    expect(calls).toHaveLength(0);
  });

  it("counts an echo core recognised as Hay.chat's own send as ignored", async () => {
    stubApi({ messageId: null, deduped: true, processed: false });
    const out = await echo({ mid: "mid.stored", text: "AI reply" });
    expect(out.body).toMatchObject({ processed: 0, ignored: 1 });
  });
});
