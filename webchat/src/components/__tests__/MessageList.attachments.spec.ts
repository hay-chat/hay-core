import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import MessageList from "../MessageList.vue";
import { provideI18n } from "@/i18n";
import type { Message } from "@/types";

/**
 * D8-9: files on messages render for the shopper and from staff or the AI;
 * the "[Customer sent a photo]" line meant for the AI is not shown.
 */

const at = new Date(2026, 9, 28, 10, 0).getTime();

function render(messages: Message[]) {
  const Root = defineComponent({
    setup() {
      provideI18n();
      return () => h(MessageList, { messages, isTyping: false });
    },
  });
  return mount(Root);
}

describe("MessageList attachments", () => {
  it("shows the photo instead of the placeholder line", () => {
    const wrapper = render([
      {
        id: "c1",
        sender: "user",
        content: "[Customer sent a photo]",
        timestamp: at,
        agentType: "Customer",
        metadata: { mediaPlaceholder: true },
        attachments: [
          {
            id: "u1",
            name: "box.jpg",
            url: "https://x.test/v1/media/u1?sig=a",
            type: "image/jpeg",
            size: 3,
          },
        ],
      },
    ]);
    expect(wrapper.text()).not.toContain("[Customer sent a photo]");
    expect(wrapper.find(".hay-message__attachment-image img").attributes("src")).toBe(
      "https://x.test/v1/media/u1?sig=a",
    );
  });

  it("shows a file from the team as a link with its name, beside the text", () => {
    const wrapper = render([
      {
        id: "h1",
        sender: "agent",
        content: "Here is your return label",
        timestamp: at,
        agentType: "HumanAgent",
        metadata: {},
        attachments: [
          {
            id: "u2",
            name: "label.pdf",
            url: "https://x.test/label?sig=b",
            type: "application/pdf",
            size: 2048,
          },
        ],
      },
    ]);
    expect(wrapper.text()).toContain("Here is your return label");
    const link = wrapper.find("a.hay-message__attachment-file");
    expect(link.attributes("href")).toBe("https://x.test/label?sig=b");
    expect(link.text()).toContain("label.pdf");
    expect(link.text()).toContain("2 KB");
  });
});
