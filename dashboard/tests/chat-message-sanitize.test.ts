// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { stubNuxtGlobals, uiStubs, translate } from "./component-harness";
import { MessageStatus, type Message } from "../types/message";

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: translate }) }));
vi.mock("@/composables/useNow", async () => {
  const { ref } = await import("vue");
  return { useNow: () => ref(new Date()) };
});

const payload = [
  "<script>window.hacked = 1</script>",
  "<img src=x onerror=alert(1)>",
  '<a href="javascript:alert(1)">click</a>',
  "[link](javascript:alert(1))",
  "![photo](https://tracker.example/pixel.png)",
].join("\n\n");

describe("ChatMessage content", () => {
  beforeEach(() => stubNuxtGlobals());

  async function render(type: string) {
    const { default: ChatMessage } = await import("../components/ChatMessage.vue");
    const message = {
      id: "m1",
      content: payload,
      type,
      status: MessageStatus.APPROVED,
      timestamp: new Date().toISOString(),
      created_at: new Date().toISOString(),
      metadata: {},
      attachments: [],
    } as unknown as Message;
    return mount(ChatMessage, {
      props: { message },
      global: { stubs: uiStubs, mocks: { $t: translate } },
    });
  }

  it.each(["Customer", "BotAgent", "HumanAgent"])(
    "strips active content from %s text",
    async (type) => {
      const { element } = await render(type);
      expect(element.querySelector("script")).toBeNull();
      for (const node of element.querySelectorAll("*")) {
        for (const attribute of node.getAttributeNames()) {
          expect(attribute.startsWith("on")).toBe(false);
          expect(node.getAttribute(attribute)?.trim().toLowerCase()).not.toMatch(/^javascript:/);
        }
      }
    },
  );

  it("never loads an image embedded in a customer's text", async () => {
    const wrapper = await render("Customer");
    const sources = wrapper.findAll("img").map((image) => image.attributes("src") ?? "");
    expect(sources.filter((src) => src.includes("tracker.example"))).toEqual([]);
  });
});
