import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { flushPromises, shallowMount } from "@vue/test-utils";
import Widget from "../Widget.vue";

/**
 * The widget must render nothing when the backend says so — the organization
 * disabled webchat or was suspended (`webchat.getPublicConfig` → { enabled: false }).
 */

vi.mock("../composables/useChat", () => ({
  useChat: () => ({
    isOpen: ref(false),
    isConnected: ref(false),
    messages: ref([]),
    isTyping: ref(false),
    unreadCount: ref(0),
    isConversationClosed: ref(false),
    currentAgentType: ref(null),
    currentAgentName: ref(null),
    toggleChat: vi.fn(),
    closeChat: vi.fn(),
    sendMessage: vi.fn(),
    startTyping: vi.fn(),
    stopTyping: vi.fn(),
    startNewConversation: vi.fn(),
  }),
}));

const config = { organizationId: "org-1", baseUrl: "https://api.example.test" };

const mockFetchResult = (data: unknown) =>
  vi.fn(async () => ({ ok: true, json: async () => ({ result: { data } }) }));

describe("Widget visibility", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders nothing when the public config reports enabled: false", async () => {
    globalThis.fetch = mockFetchResult({ enabled: false }) as unknown as typeof fetch;

    const wrapper = shallowMount(Widget, { props: { config } });
    await flushPromises();

    expect(wrapper.find(".hay-webchat-widget").exists()).toBe(false);
  });

  it("renders when the public config reports enabled: true", async () => {
    globalThis.fetch = mockFetchResult({
      enabled: true,
      agentName: "Hay",
    }) as unknown as typeof fetch;

    const wrapper = shallowMount(Widget, { props: { config } });
    await flushPromises();

    expect(wrapper.find(".hay-webchat-widget").exists()).toBe(true);
  });

  it("keeps rendering when the config request fails (network blip)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const wrapper = shallowMount(Widget, { props: { config } });
    await flushPromises();

    expect(wrapper.find(".hay-webchat-widget").exists()).toBe(true);
  });
});
