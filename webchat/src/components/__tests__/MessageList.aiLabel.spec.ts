import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import MessageList from "../MessageList.vue";
import { provideI18n } from "@/i18n";
import type { Message } from "@/types";

/**
 * AI disclosure (D14-6): the AI's name line carries the org's AI label once per
 * group of AI replies; replies from people and the shopper's own messages never
 * do. A new chat also says the AI answers.
 */

const message = (
  id: string,
  agentType: string,
  sender: Message["sender"] = "agent",
  minute = 0,
): Message => ({
  id,
  sender,
  content: `message ${id}`,
  timestamp: new Date(2026, 9, 28, 10, minute).getTime(),
  agentType,
  metadata: {},
});

const messages = [
  message("c1", "Customer", "user"),
  message("b1", "BotAgent"),
  message("b2", "BotAgent"),
  message("h1", "HumanAgent"),
  message("b3", "BotAgent"),
];

function render(aiLabel: string | null, list = messages, disclosure: string | null = null) {
  const Root = defineComponent({
    setup() {
      provideI18n();
      return () =>
        h(MessageList, {
          messages: list,
          isTyping: false,
          assistantName: "Acme assistant",
          aiLabel,
          disclosure,
        });
    },
  });
  return mount(Root);
}

const names = (wrapper: ReturnType<typeof render>) =>
  wrapper.findAll(".hay-group__name").map((name) => name.text());

describe("MessageList AI label", () => {
  it("labels each group of AI replies once", () => {
    expect(names(render("AI"))).toEqual(["Acme assistant · AI", "", "Acme assistant · AI"]);
  });

  it("shows only the name when the label is hidden", () => {
    expect(names(render(null))).toEqual(["Acme assistant", "", "Acme assistant"]);
  });

  it("puts the time in the last bubble of each group only", () => {
    const wrapper = render("AI");
    expect(wrapper.findAll(".hay-bubble")).toHaveLength(5);
    expect(wrapper.findAll(".hay-bubble__time")).toHaveLength(4);
  });

  it("shows the disclosure line when given", () => {
    expect(
      render("AI", messages, "Answered by our AI").find(".hay-thread__disclosure").text(),
    ).toBe("Answered by our AI");
    expect(render("AI").find(".hay-thread__disclosure").exists()).toBe(false);
  });

  it("shows the greeting as the AI's first message in a new chat, without a day divider", () => {
    const Root = defineComponent({
      setup() {
        provideI18n();
        return () =>
          h(MessageList, {
            messages: [],
            isTyping: false,
            assistantName: "Acme assistant",
            aiLabel: "AI",
            greetingMessage: "Hi! How can we help?",
          });
      },
    });
    const wrapper = mount(Root);
    expect(names(wrapper)).toEqual(["Acme assistant · AI"]);
    expect(wrapper.find(".hay-bubble").text()).toContain("Hi! How can we help?");
    expect(wrapper.find(".hay-thread__day").exists()).toBe(false);
  });

  it("puts typing dots in a bubble, read out as who is typing", () => {
    const Root = defineComponent({
      setup() {
        provideI18n();
        return () =>
          h(MessageList, {
            messages,
            isTyping: true,
            assistantName: "Acme assistant",
            typingHuman: { name: "Marina", avatarUrl: null },
          });
      },
    });
    const typing = mount(Root).find(".hay-typing");
    expect(typing.findAll(".hay-typing__dot")).toHaveLength(3);
    expect(typing.text()).toBe("Marina is typing");
  });
});
