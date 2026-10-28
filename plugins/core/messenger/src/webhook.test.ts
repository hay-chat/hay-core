import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import { webhookHandler } from "./webhook.js";
import type { GraphClient } from "./graph-client.js";
import { SentMessageTracker } from "./echo.js";
import { PageRegistry } from "./pages.js";

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

async function run(
  messaging: unknown[],
  options: {
    headers?: Record<string, string>;
    pageId?: string;
    tracker?: SentMessageTracker;
    receive?: () => unknown;
  } = {},
) {
  const pages = new PageRegistry();
  await pages.refresh(async () => [{ id: "page-1", name: "Store", accessToken: "page-token" }]);
  const mutation = vi.fn(
    async (_procedure: string, _input: Record<string, unknown>) =>
      (options.receive?.() ?? { messageId: "m-1", conversationId: "c-1" }) as never,
  );
  const graphClient = {
    getProfile: vi.fn(async () => ({ id: "psid-1", name: "Ana Souza" })),
  } as unknown as GraphClient;
  const { response, out } = res();

  await webhookHandler(
    {
      headers: options.headers ?? { "x-hay-webhook-verified": "true" },
      body: { object: "page", entry: [{ id: options.pageId ?? "page-1", messaging }] },
    } as unknown as Request,
    response,
    {
      getGraphClient: () => graphClient,
      pages,
      logger,
      tracker: options.tracker,
      ownAppIds: ["app-1"],
      api: { mutation },
    },
  );
  return { out, mutation, graphClient };
}

describe("Messenger webhook", () => {
  it("rejects a payload core did not verify", async () => {
    const { out, mutation } = await run([], { headers: {} });
    expect(out.statusCode).toBe(403);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("forwards a customer message as messenger:<page>:<psid> with the profile name", async () => {
    const { out, mutation, graphClient } = await run([
      {
        sender: { id: "psid-1" },
        recipient: { id: "page-1" },
        message: { mid: "mid.1", text: "Oi" },
      },
    ]);

    expect(graphClient.getProfile).toHaveBeenCalledWith("psid-1", "page-token");
    expect(out.body).toMatchObject({ processed: 1, ignored: 0 });
    expect(mutation).toHaveBeenCalledWith("messages.receive", {
      from: "messenger:page-1:psid-1",
      content: "Oi",
      channel: "messenger",
      senderType: "customer",
      metadata: expect.objectContaining({
        profileName: "Ana Souza",
        mid: "mid.1",
        pageId: "page-1",
        pageName: "Store",
      }),
    });
  });

  it("ignores entries for a Page this org has not connected", async () => {
    const { out, mutation } = await run(
      [{ sender: { id: "psid-1" }, message: { mid: "mid.1", text: "hi" } }],
      { pageId: "page-9" },
    );
    expect(out.body).toMatchObject({ processed: 0, ignored: 1 });
    expect(mutation).not.toHaveBeenCalled();
  });

  it("ignores reads, deliveries and postbacks", async () => {
    const { out, mutation } = await run([
      { sender: { id: "psid-1" }, read: { watermark: 1 } },
      { sender: { id: "psid-1" }, postback: { payload: "GET_STARTED" } },
    ]);
    expect(out.body).toMatchObject({ processed: 0, ignored: 2 });
    expect(mutation).not.toHaveBeenCalled();
  });

  it("drops the echo of Hay.chat's own send (app id)", async () => {
    const { out, mutation } = await run([
      {
        sender: { id: "page-1" },
        recipient: { id: "psid-1" },
        message: { mid: "mid.2", text: "hello", is_echo: true, app_id: "app-1" },
      },
    ]);
    expect(out.body).toMatchObject({ processed: 0, ignored: 1 });
    expect(mutation).not.toHaveBeenCalled();
  });

  it("drops the echo of a mid this worker sent", async () => {
    const tracker = new SentMessageTracker();
    tracker.remember("mid.3");
    const { mutation } = await run(
      [
        {
          sender: { id: "page-1" },
          recipient: { id: "psid-1" },
          message: { mid: "mid.3", text: "hello", is_echo: true, app_id: "263902037430900" },
        },
      ],
      { tracker },
    );
    expect(mutation).not.toHaveBeenCalled();
  });

  it("stores the owner's Page inbox reply as a human message", async () => {
    const { out, mutation } = await run([
      {
        sender: { id: "page-1" },
        recipient: { id: "psid-1" },
        message: { mid: "mid.4", text: "I'll check", is_echo: true, app_id: "263902037430900" },
      },
    ]);
    expect(out.body).toMatchObject({ processed: 1 });
    expect(mutation).toHaveBeenCalledWith(
      "messages.receive",
      expect.objectContaining({
        from: "messenger:page-1:psid-1",
        content: "I'll check",
        channel: "messenger",
        senderType: "human_agent",
        metadata: expect.objectContaining({ mid: "mid.4", echo: true, source: "page_inbox" }),
      }),
    );
  });
});
