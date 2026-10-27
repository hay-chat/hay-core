import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick, ref } from "vue";
import { shallowMount } from "@vue/test-utils";
import Widget from "../Widget.vue";

/**
 * Widget is the chat window the loader mounts. It drives the loader's button
 * (open state, unread badge) and resumes this tab's conversation on mount.
 */

const chat = {
  isOpen: ref(false),
  isInitialized: ref(false),
  messages: ref([]),
  isTyping: ref(false),
  unreadCount: ref(0),
  isConversationClosed: ref(false),
  currentAgentType: ref(null),
  currentAgentName: ref(null),
  sendFailure: ref(null),
  toggleChat: vi.fn(),
  openChat: vi.fn(),
  closeChat: vi.fn(),
  sendMessage: vi.fn(),
  startTyping: vi.fn(),
  stopTyping: vi.fn(),
  startNewConversation: vi.fn(),
  resumeActiveConversation: vi.fn(),
};

vi.mock("../composables/useChat", () => ({ useChat: () => chat }));

const config = { organizationId: "org-1", baseUrl: "https://api.example.test" };
const launcher = () => ({ setOpen: vi.fn(), setUnread: vi.fn() });

describe("Widget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chat.isOpen.value = false;
    chat.unreadCount.value = 0;
  });

  it("resumes this tab's conversation on mount without opening", () => {
    shallowMount(Widget, { props: { config, publicConfig: null, launcher: launcher() } });
    expect(chat.resumeActiveConversation).toHaveBeenCalled();
    expect(chat.openChat).not.toHaveBeenCalled();
  });

  it("opens on mount when the visitor clicked while the chat was loading", () => {
    shallowMount(Widget, {
      props: { config, publicConfig: null, launcher: launcher(), openOnMount: true },
    });
    expect(chat.openChat).toHaveBeenCalled();
  });

  it("keeps the loader's button in step with the chat", async () => {
    const bridge = launcher();
    shallowMount(Widget, { props: { config, publicConfig: null, launcher: bridge } });

    chat.unreadCount.value = 2;
    chat.isOpen.value = true;
    await nextTick();

    expect(bridge.setUnread).toHaveBeenLastCalledWith(2);
    expect(bridge.setOpen).toHaveBeenLastCalledWith(true);
  });

  it("exposes toggle() for the button", () => {
    const wrapper = shallowMount(Widget, {
      props: { config, publicConfig: null, launcher: launcher() },
    });
    (wrapper.vm as unknown as { toggle: () => void }).toggle();
    expect(chat.toggleChat).toHaveBeenCalled();
  });

  it("uses the agent name from the public config when the host sets none", async () => {
    chat.isOpen.value = true;
    const wrapper = shallowMount(Widget, {
      props: { config, publicConfig: { agentName: "Ana" }, launcher: launcher() },
    });
    expect(wrapper.findComponent({ name: "ChatWindow" }).props("agentName")).toBe("Ana");
  });
});
