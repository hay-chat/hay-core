import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeWebSocket, mockFetch, mountChat } from "./chatHarness";

vi.mock("../useDPoP", async () => (await import("./chatHarness")).dpopMock());

/**
 * Regression: a pt-BR shopper saw the Portuguese placeholder greeting replaced
 * by the server's English one. The widget now sends the locale its UI uses on
 * create, so the server writes the greeting in the same language.
 */

describe("useChat create sends the widget locale", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const originalLanguage = navigator.language;
  let createBodies: Record<string, unknown>[];

  beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    vi.spyOn(console, "error").mockImplementation(() => {});
    sessionStorage.clear();
    createBodies = [];
    mockFetch({
      "publicConversations.create": (body) => {
        createBodies.push(body);
        return { data: { id: "conv-1", nonce: "n1", createdAt: "2026-10-27T10:00:00.000Z" } };
      },
      "publicConversations.sendMessage": () => ({
        data: { messageId: "u1", nonce: "n2", createdAt: "2026-10-27T10:00:01.000Z" },
      }),
      "publicConversations.getMessages": () => ({ data: { nonce: "n3", messages: [] } }),
    });
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    Object.defineProperty(navigator, "language", { value: originalLanguage, configurable: true });
    vi.restoreAllMocks();
  });

  async function firstCreateBody(config: Parameters<typeof mountChat>[0]) {
    const { chat, unmount } = await mountChat(config);
    await chat.sendMessage("Oi");
    unmount();
    return createBodies[0];
  }

  it("sends the configured locale", async () => {
    expect(await firstCreateBody({ locale: "pt-BR" })).toMatchObject({ language: "pt-br" });
  });

  it("falls back to the browser language, like the UI", async () => {
    Object.defineProperty(navigator, "language", { value: "de-AT", configurable: true });
    expect(await firstCreateBody({})).toMatchObject({ language: "de-de" });
  });
});
