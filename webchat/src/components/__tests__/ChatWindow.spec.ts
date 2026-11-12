import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import ChatWindow from "../ChatWindow.vue";
import { provideI18n } from "@/i18n";
import type { Message } from "@/types";

/**
 * The chat window (widget spec): brand header with the shop or the person who
 * took over, the team who can step in, and the end card in place of the composer.
 */

const at = new Date(2026, 10, 12, 14, 6).getTime();
const marina: Message = {
  id: "h1",
  sender: "agent",
  content: "Hi, Marina here.",
  timestamp: at,
  agentType: "HumanAgent",
  metadata: { agentFirstName: "Marina", agentAvatarUrl: "https://cdn.test/marina.png" },
};

function render(props: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  const onStartNewConversation = vi.fn();
  const Root = defineComponent({
    setup() {
      provideI18n();
      return () =>
        h(ChatWindow, {
          title: "Acme Support",
          position: "right",
          messages: [],
          isTyping: false,
          isReady: true,
          isConversationClosed: false,
          csatEnabled: true,
          csatQuestion: "How did we do?",
          csatSubmitted: false,
          submitCsat: async () => true,
          isExpanded: false,
          assistantName: "Acme assistant",
          team: [],
          aiLabel: "AI",
          onClose,
          onStartNewConversation,
          ...props,
        });
    },
  });
  return { wrapper: mount(Root, { attachTo: document.body }), onClose, onStartNewConversation };
}

describe("ChatWindow header", () => {
  it("shows the shop's initial, title, reply status and team", () => {
    const { wrapper } = render({
      status: { text: "Typically replies in ~2 min", online: true },
      team: [
        { firstName: "Marina", avatarUrl: null },
        { firstName: "Jonas", avatarUrl: null },
      ],
    });
    const header = wrapper.find(".hay-chat-header");
    expect(header.find(".hay-chat-header__avatar--logo").text()).toBe("A");
    expect(header.find(".hay-chat-header__title").text()).toBe("Acme Support");
    expect(header.find(".hay-chat-header__subtitle").text()).toBe("Typically replies in ~2 min");
    expect(header.find(".hay-chat-header__team").attributes("aria-label")).toBe(
      "Team: Marina, Jonas",
    );
    // The back arrow waits for the home view.
    expect(header.find(".hay-chat-header__back").exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows the logo when there is one", () => {
    const { wrapper } = render({ logoUrl: "https://cdn.test/logo.png" });
    expect(wrapper.find(".hay-chat-header__avatar--logo img").attributes("src")).toBe(
      "https://cdn.test/logo.png",
    );
    wrapper.unmount();
  });

  it("becomes the person once a human has taken over, without the team", () => {
    const { wrapper } = render({
      messages: [marina],
      currentAgentType: "HumanAgent",
      team: [{ firstName: "Jonas", avatarUrl: null }],
    });
    const header = wrapper.find(".hay-chat-header");
    expect(header.find(".hay-chat-header__title").text()).toBe("Marina");
    expect(header.find(".hay-chat-header__subtitle").text()).toBe("Support team");
    expect(header.find(".hay-chat-header__avatar--human img").attributes("src")).toBe(
      "https://cdn.test/marina.png",
    );
    expect(header.find(".hay-chat-header__team").exists()).toBe(false);
    wrapper.unmount();
  });

  it("closes on Escape", async () => {
    const { wrapper, onClose } = render();
    await wrapper.find(".hay-chat-window").trigger("keydown", { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe("ChatWindow end card", () => {
  it("replaces the composer with the rating and a way to start again", async () => {
    const { wrapper, onStartNewConversation } = render({ isConversationClosed: true });
    expect(wrapper.find("textarea").exists()).toBe(false);
    const card = wrapper.find(".hay-chat-end");
    expect(card.text()).toContain("Conversation ended");
    expect(card.text()).toContain("How did we do?");
    expect(card.findAll(".hay-csat__option")).toHaveLength(5);
    await card.find(".hay-chat-end__restart").trigger("click");
    expect(onStartNewConversation).toHaveBeenCalled();
    expect(card.find(".hay-chat-end__restart").text()).toBe("Start a new conversation");
    wrapper.unmount();
  });

  it("thanks the shopper once rated", () => {
    const { wrapper } = render({ isConversationClosed: true, csatSubmitted: true });
    expect(wrapper.find(".hay-chat-end").text()).toContain("Thanks for your feedback");
    wrapper.unmount();
  });
});
