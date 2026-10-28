import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { boot, type ChatModule } from "../boot";
import type { ChatMountOptions, HayChatConfig } from "@/types";

/**
 * widget.js paints the button right away and loads the chat chunk according to
 * `loading` (D12-6 / D12-7). These tests drive the loader with a fake chunk.
 */

const config: HayChatConfig = { organizationId: "org-1", baseUrl: "https://api.example.test" };

function fakeChunk() {
  const toggle = vi.fn();
  const mountChat = vi.fn(async (_options: ChatMountOptions) => ({ toggle }));
  const loadChat = vi.fn(async (): Promise<ChatModule> => ({ mountChat }));
  return { loadChat, mountChat, toggle };
}

function mockPublicConfig(data: unknown, ok = true) {
  const fn = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    statusText: "",
    json: async () => ({ result: { data } }),
  }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const button = () => document.querySelector<HTMLButtonElement>("button.hay-chat-button");

describe("widget loader", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    delete window.HayChat;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("idle (default): paints the button at once, loads the chat when the browser is idle", async () => {
    const fetchMock = mockPublicConfig({ enabled: true });
    const chunk = fakeChunk();

    const loader = boot(config, chunk.loadChat);

    expect(button()).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // settings, to know whether to show at all
    expect(chunk.loadChat).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3000);
    expect(chunk.loadChat).toHaveBeenCalledTimes(1);
    await loader.chatReady();
    expect(chunk.mountChat).toHaveBeenCalledWith(
      expect.objectContaining({ open: false, publicConfig: { enabled: true } }),
    );
  });

  it("eager: loads the chat straight away", async () => {
    mockPublicConfig({ enabled: true });
    const chunk = fakeChunk();
    boot({ ...config, loading: "eager" }, chunk.loadChat);
    expect(chunk.loadChat).toHaveBeenCalledTimes(1);
  });

  it("interaction: fetches nothing until the visitor reaches for the button", async () => {
    const fetchMock = mockPublicConfig({ enabled: true });
    const chunk = fakeChunk();
    const loader = boot({ ...config, loading: "interaction" }, chunk.loadChat);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chunk.loadChat).not.toHaveBeenCalled();

    button()!.dispatchEvent(new Event("pointerenter"));
    await loader.chatReady();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(chunk.mountChat).toHaveBeenCalledWith(expect.objectContaining({ open: false }));
  });

  it("a click before the chat loaded opens it once mounted; later clicks toggle it", async () => {
    mockPublicConfig({ enabled: true });
    const chunk = fakeChunk();
    const loader = boot({ ...config, loading: "interaction" }, chunk.loadChat);

    button()!.click();
    expect(button()!.getAttribute("aria-busy")).toBe("true");
    await loader.chatReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(chunk.mountChat).toHaveBeenCalledWith(expect.objectContaining({ open: true }));
    expect(button()!.hasAttribute("aria-busy")).toBe(false);

    button()!.click();
    expect(chunk.toggle).toHaveBeenCalledTimes(1);
    expect(chunk.loadChat).toHaveBeenCalledTimes(1);
  });

  it("removes the button and never downloads the chat when the widget is disabled", async () => {
    mockPublicConfig({ enabled: false });
    const chunk = fakeChunk();
    boot(config, chunk.loadChat);

    await vi.advanceTimersByTimeAsync(5000);
    expect(document.getElementById("hay-webchat-root")).toBeNull();
    expect(chunk.loadChat).not.toHaveBeenCalled();
  });

  it("idle: waits for the settings before downloading, even when the browser is idle first", async () => {
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 200,
                statusText: "",
                json: async () => ({ result: { data: { enabled: false } } }),
              }),
            10_000,
          ),
        ),
    ) as unknown as typeof fetch;
    const chunk = fakeChunk();
    boot(config, chunk.loadChat);

    await vi.advanceTimersByTimeAsync(5000); // idle has fired, settings still pending
    expect(chunk.loadChat).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(document.getElementById("hay-webchat-root")).toBeNull();
    expect(chunk.loadChat).not.toHaveBeenCalled();
  });

  it("keeps the button when the settings request fails (network blip)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const chunk = fakeChunk();
    const loader = boot(config, chunk.loadChat);

    await vi.advanceTimersByTimeAsync(3000);
    await loader.chatReady();
    expect(button()).not.toBeNull();
    expect(chunk.mountChat).toHaveBeenCalledWith(expect.objectContaining({ publicConfig: null }));
  });

  it("loads straight away when the visitor already has a conversation in this tab", () => {
    sessionStorage.setItem("hay-conversation-id", "conv-1");
    mockPublicConfig({ enabled: true });
    const chunk = fakeChunk();
    boot({ ...config, loading: "interaction" }, chunk.loadChat);
    expect(chunk.loadChat).toHaveBeenCalledTimes(1);
  });

  it("lets a failed chunk download be retried by the next click", async () => {
    mockPublicConfig({ enabled: true });
    const chunk = fakeChunk();
    chunk.loadChat.mockRejectedValueOnce(new Error("chunk 404"));
    const loader = boot({ ...config, loading: "interaction" }, chunk.loadChat);

    button()!.click();
    expect(await loader.chatReady()).toBeNull();
    button()!.click();
    await loader.chatReady();
    expect(chunk.mountChat).toHaveBeenCalledTimes(1);
  });

  it("labels the button in the visitor's language", () => {
    mockPublicConfig({ enabled: true });
    boot({ ...config, locale: "pt-BR", loading: "interaction" }, fakeChunk().loadChat);
    expect(button()!.getAttribute("aria-label")).toBe("Abrir chat");
  });

  it("records host API calls made before the chat loaded and hands them to it in order", async () => {
    mockPublicConfig({ enabled: true });
    const chunk = fakeChunk();
    const loader = boot({ ...config, loading: "interaction" }, chunk.loadChat);

    window.HayChat!.addContext!("cart", { items: 2 });
    window.HayChat!.grantConsent!();

    button()!.click();
    await loader.chatReady();
    expect(chunk.mountChat.mock.calls[0][0].hostCalls).toEqual([
      { name: "addContext", args: ["cart", { items: 2 }] },
      { name: "grantConsent", args: [] },
    ]);
  });

  it("revokeConsent before the chat loaded wipes stored Hay.chat data right away", () => {
    mockPublicConfig({ enabled: true });
    localStorage.setItem("hay-customer-id", "anon_1");
    localStorage.setItem("host-key", "keep");
    boot({ ...config, loading: "interaction" }, fakeChunk().loadChat);

    window.HayChat!.revokeConsent!();
    expect(localStorage.getItem("hay-customer-id")).toBeNull();
    expect(localStorage.getItem("host-key")).toBe("keep");
  });

  it("writes nothing to storage while loading", async () => {
    mockPublicConfig({ enabled: true });
    const loader = boot({ ...config, loading: "eager" }, fakeChunk().loadChat);
    await loader.chatReady();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });
});
