import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import MessageList from "../MessageList.vue";
import { provideI18n, type Translations } from "@/i18n";
import ptBr from "@/i18n/locales/pt-br";
import type { Message } from "@/types";

/**
 * Shoppers must know when they are talking to a person: a centred pill when a
 * team member joins or leaves, and the person's first name above their
 * replies. Worded in the shopper's language from structured metadata.
 */

const at = (minute: number) => new Date(2026, 9, 27, 10, minute).getTime();

const joined: Message = {
  id: "s1",
  sender: "agent",
  content: "",
  timestamp: at(41),
  agentType: "System",
  metadata: { systemEvent: "agent_joined", agentFirstName: "Marina" },
};
const reply: Message = {
  id: "h1",
  sender: "agent",
  content: "Hi, I can help",
  timestamp: at(42),
  agentType: "HumanAgent",
  metadata: { agentFirstName: "Marina" },
};
const backToAi: Message = {
  id: "s2",
  sender: "agent",
  content: "",
  timestamp: at(50),
  agentType: "System",
  metadata: { systemEvent: "agent_returned_to_ai", agentFirstName: "Marina" },
};
const botReply: Message = {
  id: "b1",
  sender: "agent",
  content: "Anything else?",
  timestamp: at(51),
  agentType: "BotAgent",
  metadata: {},
};

function render(messages: Message[], translations?: Translations) {
  const Root = defineComponent({
    setup() {
      provideI18n(translations);
      return () => h(MessageList, { messages, isTyping: false, assistantName: "Acme assistant" });
    },
  });
  return mount(Root);
}

const lines = (wrapper: ReturnType<typeof render>) =>
  wrapper.findAll(".hay-notice__text").map((line) => line.text());

describe("MessageList agent notices", () => {
  it("shows centred join/leave pills in English, the name in bold", () => {
    const wrapper = render([joined, reply, backToAi]);
    expect(lines(wrapper)).toEqual([
      "Marina joined the chat",
      "Marina left the chat. You're chatting with the AI assistant again.",
    ]);
    expect(wrapper.find(".hay-notice b").text()).toBe("Marina");
  });

  it("shows the person's photo on the pill when the server sends one", () => {
    const withPhoto = { ...joined, metadata: { ...joined.metadata, agentAvatarUrl: "/m.png" } };
    expect(render([withPhoto]).find(".hay-notice img").attributes("src")).toBe("/m.png");
    expect(render([joined]).find(".hay-notice .hay-avatar").text()).toBe("M");
  });

  it("words them in the shopper's language", () => {
    const wrapper = render([joined, backToAi], ptBr as Translations);
    expect(lines(wrapper)).toEqual([
      "Marina entrou na conversa",
      "Marina saiu da conversa. Você está falando com o assistente de IA novamente.",
    ]);
  });

  it("says 'left the chat' without the AI promise when released to the queue", () => {
    const left = { ...backToAi, metadata: { systemEvent: "agent_left", agentFirstName: "Marina" } };
    expect(lines(render([left]))).toEqual(["Marina left the chat"]);
  });

  it("falls back to 'A team member' when there is no first name", () => {
    expect(lines(render([{ ...joined, metadata: { systemEvent: "agent_joined" } }]))).toEqual([
      "A team member joined the chat",
    ]);
  });

  it("names the person above their replies, and the AI with its label", () => {
    const wrapper = render([reply, botReply]);
    const names = wrapper.findAll(".hay-group__name").map((name) => name.text());
    expect(names).toEqual(["Marina", "Acme assistant"]);
    const times = wrapper.findAll(".hay-bubble__time").map((time) => time.text());
    expect(times).toEqual(["10:42", "10:51"]);
  });

  it("ignores System messages without a known event", () => {
    const other = { ...joined, metadata: { systemEvent: "something_else" } };
    expect(lines(render([other]))).toEqual([]);
  });
});
