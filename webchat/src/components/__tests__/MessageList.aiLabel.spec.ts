import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import MessageList from "../MessageList.vue";
import { provideI18n } from "@/i18n";
import type { Message } from "@/types";

/**
 * AI disclosure (D14-6): every AI reply carries the org's AI label; replies from
 * people and the shopper's own messages never do.
 */

const message = (id: string, agentType: string, sender: Message["sender"] = "agent"): Message => ({
  id,
  sender,
  content: `message ${id}`,
  timestamp: new Date(2026, 9, 28, 10, 0).getTime(),
  agentType,
  metadata: {},
});

const messages = [
  message("c1", "Customer", "user"),
  message("b1", "BotAgent"),
  message("h1", "HumanAgent"),
  message("b2", "BotAgent"),
];

function badges(aiLabel: string | null) {
  const Root = defineComponent({
    setup() {
      provideI18n();
      return () => h(MessageList, { messages, isTyping: false, aiLabel });
    },
  });
  return mount(Root)
    .findAll(".hay-message__ai-badge")
    .map((badge) => badge.text());
}

describe("MessageList AI label", () => {
  it("labels AI replies only", () => {
    expect(badges("AI assistant")).toEqual(["AI assistant", "AI assistant"]);
  });

  it("shows nothing when the label is hidden", () => {
    expect(badges(null)).toEqual([]);
  });
});
