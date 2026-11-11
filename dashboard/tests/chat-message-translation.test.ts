// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { stubNuxtGlobals, uiStubs, translate } from "./component-harness";
import { MessageStatus, type Message } from "../types/message";
import type { DisplayTranslation } from "../composables/useMessageTranslations";

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: translate }) }));
vi.mock("@/composables/useNow", async () => {
  const { ref } = await import("vue");
  return { useNow: () => ref(new Date()) };
});

const portuguese: DisplayTranslation = {
  text: "Waar is mijn bestelling?",
  sourceLanguage: "pt",
  language: "nl",
};

describe("ChatMessage translation", () => {
  beforeEach(() => stubNuxtGlobals());

  async function render(
    type: string,
    props: { translation?: DisplayTranslation | null; translating?: boolean } = {},
  ) {
    const { default: ChatMessage } = await import("../components/ChatMessage.vue");
    const message = {
      id: "m1",
      content: "Onde está meu pedido?",
      type,
      status: MessageStatus.APPROVED,
      created_at: new Date().toISOString(),
      metadata: {},
      attachments: [],
    } as unknown as Message;
    return mount(ChatMessage, {
      props: { message, ...props },
      global: { stubs: uiStubs, mocks: { $t: translate } },
    });
  }

  it("shows the translation by default and toggles to the original", async () => {
    const wrapper = await render("Customer", { translation: portuguese });
    const line = wrapper.get('[data-testid="message-translation"]');

    expect(wrapper.get(".chat-message__text").text()).toBe("Waar is mijn bestelling?");
    expect(line.text()).toMatch(
      /conversations\.translation\.translatedFrom \{"language":"[^"]*Portuguese"\}/,
    );

    const toggle = line.get("button");
    expect(toggle.attributes("type")).toBe("button");
    expect(toggle.text()).toBe("conversations.translation.showOriginal");
    await toggle.trigger("click");

    expect(wrapper.get(".chat-message__text").text()).toBe("Onde está meu pedido?");
    expect(toggle.text()).toBe("conversations.translation.showTranslation");
  });

  it("labels a team reply with the language it was sent in", async () => {
    const wrapper = await render("HumanAgent", { translation: portuguese });
    const line = wrapper.get('[data-testid="message-translation"]');

    expect(line.text()).toMatch(
      /conversations\.translation\.sentIn \{"language":"[^"]*Portuguese"\}/,
    );
    expect(line.get("button").text()).toBe("conversations.translation.showSent");
  });

  it("shows the original with a quiet indicator while translating", async () => {
    const wrapper = await render("BotAgent", { translating: true });

    expect(wrapper.get(".chat-message__text").text()).toBe("Onde está meu pedido?");
    expect(wrapper.get('[data-testid="message-translating"]').attributes("role")).toBe("status");
  });

  it("renders as before when no translation applies", async () => {
    const same = { ...portuguese, text: "Onde está meu pedido?" };
    for (const props of [{}, { translation: same }]) {
      const wrapper = await render("Customer", props);
      expect(wrapper.find('[data-testid="message-translation"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="message-translating"]').exists()).toBe(false);
      expect(wrapper.get(".chat-message__text").text()).toBe("Onde está meu pedido?");
    }
  });
});
