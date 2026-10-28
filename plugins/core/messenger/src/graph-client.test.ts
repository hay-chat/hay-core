import { afterEach, describe, expect, it, vi } from "vitest";
import type { HayLogger } from "@hay/plugin-sdk/types";
import { GraphApiError, GraphClient, splitText } from "./graph-client.js";
import { messengerAddress, PageRegistry, parseAddress } from "./pages.js";

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as HayLogger;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(responseBody: unknown, status = 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(responseBody), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("GraphClient sends", () => {
  it("sends a normal reply as RESPONSE with the Page token", async () => {
    const fetchMock = stubFetch({ message_id: "mid.1" });
    const mid = await new GraphClient({ logger }).sendText(
      "psid-1",
      "hi",
      "page-token",
      "response",
    );

    expect(mid).toBe("mid.1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe("/v21.0/me/messages");
    expect(new URL(url).searchParams.get("access_token")).toBe("page-token");
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { id: "psid-1" },
      messaging_type: "RESPONSE",
      message: { text: "hi" },
    });
  });

  it("tags a person's late reply HUMAN_AGENT", async () => {
    const fetchMock = stubFetch({ message_id: "mid.2" });
    await new GraphClient({ logger }).sendAttachment(
      "psid-1",
      { type: "image", url: "https://x.test/a.png" },
      "page-token",
      "human_agent",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      recipient: { id: "psid-1" },
      messaging_type: "MESSAGE_TAG",
      tag: "HUMAN_AGENT",
      message: {
        attachment: { type: "image", payload: { url: "https://x.test/a.png", is_reusable: false } },
      },
    });
  });

  it("carries Meta's code and subcode on a refusal", async () => {
    stubFetch({ error: { message: "outside window", code: 10, error_subcode: 2018278 } }, 400);
    const error = await new GraphClient({ logger })
      .sendText("psid-1", "hi", "t", "response")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphApiError);
    expect(error).toMatchObject({ status: 400, code: 10, subcode: 2018278 });
  });

  it("lists the granted Pages with their tokens", async () => {
    stubFetch({
      data: [
        { id: "1", name: "Store", access_token: "t1" },
        { id: "2", name: "No token" },
      ],
    });
    expect(await new GraphClient({ logger }).listPages("user-token")).toEqual([
      { id: "1", name: "Store", accessToken: "t1" },
    ]);
  });
});

describe("splitText", () => {
  it("keeps short text whole", () => {
    expect(splitText("hello")).toEqual(["hello"]);
  });

  it("splits at a word break under the limit", () => {
    const chunks = splitText("aaaa bbbb cccc", 10);
    expect(chunks).toEqual(["aaaa bbbb", "cccc"]);
  });

  it("hard-splits a single long word", () => {
    expect(splitText("x".repeat(25), 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });
});

describe("Messenger addresses and Pages", () => {
  it("round-trips a Page-scoped address", () => {
    expect(parseAddress(messengerAddress("page-1", "psid-1"))).toEqual({
      pageId: "page-1",
      psid: "psid-1",
    });
    expect(parseAddress("messenger:psid-only")).toBeNull();
    expect(parseAddress("instagram:1")).toBeNull();
  });

  it("waits for a refresh in progress before answering", async () => {
    const pages = new PageRegistry();
    let resolve: (value: Array<{ id: string; accessToken: string }>) => void = () => undefined;
    void pages.refresh(() => new Promise((r) => (resolve = r)));
    const lookup = pages.get("p1");
    resolve([{ id: "p1", accessToken: "t" }]);
    expect(await lookup).toEqual({ id: "p1", accessToken: "t" });
  });
});
