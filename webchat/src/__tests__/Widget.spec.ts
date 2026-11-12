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
  conversationStatus: ref<string | null>(null),
  contactEmailSaved: ref(false),
  saveContactEmail: vi.fn(),
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
const launcher = () => ({ setOpen: vi.fn(), setUnread: vi.fn(), focus: vi.fn() });

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

  it("gives focus back to the button when the chat closes", async () => {
    const bridge = launcher();
    shallowMount(Widget, { props: { config, publicConfig: null, launcher: bridge } });
    chat.isOpen.value = true;
    await nextTick();
    expect(bridge.focus).not.toHaveBeenCalled();
    chat.isOpen.value = false;
    await nextTick();
    expect(bridge.focus).toHaveBeenCalledTimes(1);
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
    expect(wrapper.findComponent({ name: "ChatWindow" }).props("assistantName")).toBe("Ana");
  });

  it("reads the title, logo and team from the public config (C1)", () => {
    chat.isOpen.value = true;
    const window = shallowMount(Widget, {
      props: {
        config,
        publicConfig: {
          widgetTitle: "Acme Support",
          logoUrl: "/uploads/logo.png",
          team: [
            { firstName: "Marina", avatarUrl: "https://cdn.test/m.png" },
            { firstName: "Jonas", avatarUrl: null },
            { firstName: "Third", avatarUrl: null },
          ],
        },
        launcher: launcher(),
      },
    }).findComponent({ name: "ChatWindow" });
    expect(window.props("title")).toBe("Acme Support");
    expect(window.props("logoUrl")).toBe("https://api.example.test/uploads/logo.png");
    expect(window.props("team")).toEqual([
      { firstName: "Marina", avatarUrl: "https://cdn.test/m.png" },
      { firstName: "Jonas", avatarUrl: null },
    ]);
    expect(window.props("assistantName")).toBe("Assistant");
  });

  it("the page's own title wins over the settings", () => {
    chat.isOpen.value = true;
    const window = shallowMount(Widget, {
      props: {
        config: { ...config, widgetTitle: "From the page" },
        publicConfig: { widgetTitle: "From settings" },
        launcher: launcher(),
      },
    }).findComponent({ name: "ChatWindow" });
    expect(window.props("title")).toBe("From the page");
  });

  it("labels AI replies by default, with the org's text, or not at all when hidden", () => {
    chat.isOpen.value = true;
    const aiLabel = (publicConfig: Record<string, unknown> | null) =>
      shallowMount(Widget, { props: { config, publicConfig, launcher: launcher() } })
        .findComponent({ name: "ChatWindow" })
        .props("aiLabel");

    expect(aiLabel(null)).toBe("AI");
    expect(aiLabel({ aiLabelShown: true, aiLabelText: null })).toBe("AI");
    expect(aiLabel({ aiLabelShown: true, aiLabelText: "Aurora bot" })).toBe("Aurora bot");
    expect(aiLabel({ aiLabelShown: false, aiLabelText: "Aurora bot" })).toBeNull();
  });

  it("shows the business-hours status and the waiting state (D5-7, D5-10)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          data: {
            state: "open_nobody_online",
            nextOpening: null,
            timezone: "Europe/Lisbon",
            hasSchedule: true,
            typicalReplyMinutes: 12,
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    chat.isOpen.value = false;
    chat.conversationStatus.value = "pending-human";
    const wrapper = shallowMount(Widget, {
      props: { config, publicConfig: null, launcher: launcher() },
    });
    chat.isOpen.value = true;
    await vi.waitFor(() =>
      expect(wrapper.findComponent({ name: "ChatWindow" }).props("status")).toEqual({
        text: "Typically replies in ~12 min",
        online: true,
      }),
    );
    const window = wrapper.findComponent({ name: "ChatWindow" });
    expect(window.props("isWaitingForHuman")).toBe(true);
    expect(window.props("waitingTypical")).toBe("usually ~12 min");
    expect(window.props("waitingDetail")).toBe("We've alerted the team.");

    chat.currentAgentType.value = "HumanAgent" as never;
    await nextTick();
    expect(window.props("isWaitingForHuman")).toBe(false);
    chat.currentAgentType.value = null;
    chat.conversationStatus.value = null;
    vi.unstubAllGlobals();
  });
});
