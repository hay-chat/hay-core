import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeWebSocket, mockFetch, mountChat } from "./chatHarness";

vi.mock("../useDPoP", async () => (await import("./chatHarness")).dpopMock());

/**
 * The widget sends the customer's raw language tag on create, so the server
 * writes the greeting (and the conversation's language) in it. It must not be
 * squeezed through the widget's UI locales: a Swedish browser once became "en".
 */

describe("useChat create sends the customer's language", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const originalLanguage = navigator.language;
  const originalLanguages = navigator.languages;
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
    Object.defineProperty(navigator, "languages", {
      value: originalLanguages,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  async function firstCreateBody(config: Parameters<typeof mountChat>[0]) {
    const { chat, unmount } = await mountChat(config);
    await chat.sendMessage("Oi");
    unmount();
    return createBodies[0];
  }

  function setBrowserLanguages(languages: string[], language: string) {
    Object.defineProperty(navigator, "languages", { value: languages, configurable: true });
    Object.defineProperty(navigator, "language", { value: language, configurable: true });
  }

  it("sends the configured locale as given", async () => {
    setBrowserLanguages(["sv-SE"], "sv-SE");
    expect(await firstCreateBody({ locale: "pt-BR" })).toMatchObject({ language: "pt-BR" });
  });

  it("sends the browser's preferred language, even one the widget UI lacks", async () => {
    setBrowserLanguages(["sv-SE", "en-US"], "en-US");
    expect(await firstCreateBody({})).toMatchObject({ language: "sv-SE" });
  });

  it("falls back to navigator.language when languages is empty", async () => {
    setBrowserLanguages([], "de-AT");
    expect(await firstCreateBody({})).toMatchObject({ language: "de-AT" });
  });
});
