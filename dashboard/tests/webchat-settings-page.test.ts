// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, route, stubNuxtGlobals } from "./component-harness";

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  setUnderAttack: vi.fn(),
}));
vi.mock("@/utils/api", () => ({
  Hay: {
    webchat: {
      getSettings: { query: api.getSettings },
      updateSettings: { mutate: api.updateSettings },
      setUnderAttack: { mutate: api.setUnderAttack },
    },
  },
  HayApi: {},
}));
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/composables/useDomain", () => ({
  useDomain: () => ({ getApiUrl: (path = "") => `https://api.hay.test${path}` }),
}));

import WebchatPage from "../pages/channels/webchat.vue";
import WebchatContentTab from "../components/webchat/WebchatContentTab.vue";
import WebchatSecurityTab from "../components/webchat/WebchatSecurityTab.vue";
import WebchatStatusPill from "../components/webchat/WebchatStatusPill.vue";

const passThrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots }) {
    return () => h("div", slots.default?.());
  },
});

const saved = {
  isEnabled: true,
  brandColor: "#14532d",
  brandColorSource: "website",
  brandPalette: ["#14532d", "#65a30d"],
  logoUrl: null,
  logoSource: null,
  themeMode: "light",
  position: "right",
  widgetTitle: "Chat with us",
  homeHeading: null,
  showGreeting: true,
  greetingMessage: "Hi!",
  teaserMessage: null,
  csatEnabled: true,
  csatQuestion: null,
  preChatForm: null,
  allowedDomains: ["acme.com"],
  pageTools: { enabled: false, allowedOrigins: [] },
  spamClassifierEnabled: false,
  spamGuidance: null,
  lastSeenAt: null,
  lastSeenOrigin: null,
  underAttack: { active: false, until: null, source: null },
  underAttackHours: 4,
};

const mountPage = () =>
  mountWithStubs(WebchatPage, {
    stubs: {
      WebchatContentTab,
      WebchatSecurityTab,
      WebchatStatusPill,
      WebchatAppearanceTab: true,
      WebchatInstallTab: true,
      WebchatPreview: true,
      PreChatFormBuilder: true,
      Sheet: passThrough,
      SheetHeader: passThrough,
      SheetTitle: passThrough,
      SheetDescription: passThrough,
      SheetContent: passThrough,
      SheetFooter: passThrough,
      Alert: passThrough,
      AlertTitle: passThrough,
      AlertDescription: passThrough,
      ChevronLeft: true,
    },
  });

const saveBar = (wrapper: ReturnType<typeof mountPage>) =>
  wrapper.find('[data-testid="webchat-save-bar"]');
const button = (wrapper: ReturnType<typeof mountPage>, key: string) =>
  wrapper.findAll("button").find((b) => b.text() === key)!;

describe("Webchat settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubNuxtGlobals();
    route.query = { tab: "content" };
    api.getSettings.mockResolvedValue(saved);
    api.updateSettings.mockResolvedValue({});
  });

  it("shows the save bar only after a change, and saves the edit", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(saveBar(wrapper).exists()).toBe(false);
    expect(wrapper.find('[data-testid="webchat-status-notInstalled"]').exists()).toBe(true);

    await wrapper.find('input[aria-label="webchat.content.heading"]').setValue("Hello there");
    expect(saveBar(wrapper).exists()).toBe(true);

    api.getSettings.mockResolvedValue({ ...saved, homeHeading: "Hello there" });
    await button(wrapper, "webchat.saveBar.save").trigger("click");
    await flushPromises();

    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        homeHeading: "Hello there",
        brandColor: "#14532d",
        themeMode: "light",
        allowedDomains: ["acme.com"],
      }),
    );
    expect(saveBar(wrapper).exists()).toBe(false);
  });

  it("discard puts the saved values back", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const heading = wrapper.find('input[aria-label="webchat.content.heading"]');
    await heading.setValue("Draft");
    await button(wrapper, "webchat.saveBar.discard").trigger("click");

    expect(saveBar(wrapper).exists()).toBe(false);
    expect((heading.element as HTMLInputElement).value).toBe("");
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("turns on under-attack mode straight away, without the save bar", async () => {
    route.query = { tab: "security" };
    api.setUnderAttack.mockResolvedValue({
      active: true,
      until: "2026-11-12T16:00:00Z",
      source: "owner",
    });
    const wrapper = mountPage();
    await flushPromises();

    await button(wrapper, "webchat.security.turnOn").trigger("click");
    await flushPromises();

    expect(api.setUnderAttack).toHaveBeenCalledWith({ enabled: true });
    expect(wrapper.find('[data-testid="webchat-under-attack-pill"]').text()).toBe(
      "webchat.security.on",
    );
    expect(saveBar(wrapper).exists()).toBe(false);
  });
});
