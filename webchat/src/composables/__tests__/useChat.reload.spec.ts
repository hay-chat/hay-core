import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { FakeWebSocket, mockFetch, mountChat } from "./chatHarness";
import { initConsent, grantConsent, revokeConsent } from "../useConsent";
import { getKeypair, storeKeypair } from "../useDPoP";

vi.mock("../useDPoP", async () => (await import("./chatHarness")).dpopMock());

/**
 * Regression: in the default consent mode a reload lost the shopper's
 * conversation. Each page load started with the storage gates closed, so the
 * stored conversation ID was never read; the widget then created a new
 * conversation and customer and, once the shopper typed, overwrote the stored
 * ones. A shopper waiting for a human lost the thread.
 */

const history = [
  {
    id: "u1",
    type: "Customer",
    content: "Can I talk to a person?",
    createdAt: "2026-10-27T10:00:03.000Z",
  },
  {
    id: "a1",
    type: "HumanAgent",
    sender: "Ana",
    content: "Hi, Ana here.",
    createdAt: "2026-10-27T10:01:00.000Z",
  },
];

// Stand-in for the IndexedDB key store, surviving a "reload".
const keyStore = new Map<string, Awaited<ReturnType<typeof getKeypair>>>();

async function settle() {
  await vi.advanceTimersByTimeAsync(200);
}

/** Simulates a page load: module state resets, browser storage survives. */
async function loadPage(mode: "implicit" | "strict" = "implicit") {
  initConsent(mode);
  return mountChat({ consent: mode });
}

describe("useChat resume after reload", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  let createCount = 0;
  let fetchMock: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    vi.spyOn(console, "error").mockImplementation(() => {});
    keyStore.clear();
    createCount = 0;
    vi.mocked(storeKeypair).mockImplementation(async (id, privateKey, publicKey, publicJwk) => {
      keyStore.set(id, {
        conversationId: id,
        privateKey,
        publicKey,
        publicJwk,
        createdAt: new Date(),
      });
    });
    vi.mocked(getKeypair).mockImplementation(async (id) => keyStore.get(id) ?? null);
    fetchMock = mockFetch({
      "publicConversations.create": () => {
        createCount++;
        return {
          data: { id: `conv-${createCount}`, nonce: "n1", createdAt: "2026-10-27T10:00:00.000Z" },
        };
      },
      "publicConversations.sendMessage": () => ({
        data: { messageId: "u1", nonce: "n2", createdAt: history[0].createdAt },
      }),
      "publicConversations.getMessages": () => ({ data: { nonce: "n3", messages: history } }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /** First page: the shopper opens the widget and writes. */
  async function chatOnFirstPage(mode: "implicit" | "strict" = "implicit") {
    const page = await loadPage(mode);
    if (mode === "strict") grantConsent();
    page.chat.toggleChat();
    await settle();
    await page.chat.sendMessage(history[0].content);
    await settle();
    const customerId = localStorage.getItem("hay-customer-id");
    page.unmount();
    return { customerId };
  }

  it("resumes the same conversation and customer after a reload (implicit mode)", async () => {
    const { customerId } = await chatOnFirstPage();
    expect(createCount).toBe(1);
    expect(customerId).toBeTruthy();

    const { chat, unmount } = await loadPage();
    chat.resumeActiveConversation();
    await settle();

    expect(createCount).toBe(1);
    expect(chat.conversationId.value).toBe("conv-1");
    expect(chat.messages.value.map((m) => m.content)).toContain("Hi, Ana here.");
    expect(localStorage.getItem("hay-customer-id")).toBe(customerId);
    expect(sessionStorage.getItem("hay-conversation-id")).toBe("conv-1");
    unmount();
  });

  it("resumes without a click, so a reply that arrived meanwhile shows on the badge", async () => {
    await chatOnFirstPage();

    const { chat, unmount } = await loadPage();
    chat.resumeActiveConversation();
    await settle();

    expect(chat.isOpen.value).toBe(false);
    expect(chat.unreadCount.value).toBe(1);
    unmount();
  });

  it("does not touch storage or the network on a fresh page with no chat in this tab", async () => {
    const { chat, unmount } = await loadPage();
    chat.resumeActiveConversation();
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    unmount();
  });

  it("strict mode: waits for a late grantConsent() and then resumes, instead of starting over", async () => {
    await chatOnFirstPage("strict");

    const { chat, unmount } = await loadPage("strict");
    chat.resumeActiveConversation();
    await settle();
    // The key is behind the consent gate: nothing is resumed and nothing new is created.
    expect(createCount).toBe(1);
    expect(sessionStorage.getItem("hay-conversation-id")).toBe("conv-1");

    // The cookie banner answers after the widget loaded.
    grantConsent();
    await nextTick();
    await settle();

    expect(createCount).toBe(1);
    expect(chat.conversationId.value).toBe("conv-1");
    expect(chat.messages.value.map((m) => m.content)).toContain("Hi, Ana here.");
    unmount();
  });

  it("keeps honouring a revoke after a reload", async () => {
    await chatOnFirstPage();
    revokeConsent();
    expect(localStorage.getItem("hay-customer-id")).toBeNull();

    const { chat, unmount } = await loadPage();
    chat.resumeActiveConversation();
    await settle();

    expect(localStorage.getItem("hay-customer-id")).toBeNull();
    unmount();
  });
});
