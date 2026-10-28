import { vi } from "vitest";
import { createApp } from "vue";
import type { HayChatConfig } from "@/types";

/**
 * Shared harness for useChat tests: a fake WebSocket that opens immediately
 * and a scripted fetch for the publicConversations endpoints. useDPoP must be
 * mocked by the test file itself (vi.mock is hoisted per file).
 */

export class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send() {}
  close() {}
  receive(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

type Route = (body: Record<string, unknown>) => { status?: number; data?: unknown; error?: unknown };

export function mockFetch(routes: Record<string, Route>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const name = Object.keys(routes).find((key) => url.includes(key));
    if (!name) throw new Error(`unexpected fetch ${url}`);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const { status = 200, data, error } = routes[name](body);
    const payload = status >= 400 ? { error } : { result: { data } };
    return { ok: status < 400, status, json: async () => payload } as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

export async function mountChat(
  config: Partial<HayChatConfig> = {},
  options: import("../useChat").UseChatOptions = {},
) {
  const { useChat } = await import("../useChat");
  let chat!: ReturnType<typeof useChat>;
  const app = createApp({
    setup() {
      chat = useChat({
        organizationId: "org-1",
        baseUrl: "https://api.example.test",
        showGreeting: true,
        greetingMessage: "Hello! How can we help you today?",
        ...config,
      }, options);
      return () => null;
    },
  });
  app.mount(document.createElement("div"));
  return {
    chat,
    unmount: () => {
      chat.disconnect();
      app.unmount();
    },
  };
}

export const dpopMock = () => ({
  generateKeypair: vi.fn(async () => ({
    privateKey: {} as CryptoKey,
    publicKey: {} as CryptoKey,
    publicJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
  })),
  storeKeypair: vi.fn(async () => {}),
  getKeypair: vi.fn(async () => null),
  clearKeypair: vi.fn(async () => {}),
  clearAllKeypairs: vi.fn(async () => {}),
  createDPoPProof: vi.fn(async () => "proof"),
});
