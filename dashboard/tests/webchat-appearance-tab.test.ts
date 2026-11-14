// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, stubNuxtGlobals } from "./component-harness";

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getAssistant: vi.fn(),
  removeAvatar: vi.fn(),
  orgSettings: vi.fn(),
}));
vi.mock("@/utils/api", () => ({
  Hay: {
    webchat: { getSettings: { query: api.getSettings } },
    organizations: {
      getSettings: { query: api.orgSettings },
      assistant: {
        get: { query: api.getAssistant },
        removeAvatar: { mutate: api.removeAvatar },
      },
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
vi.mock("@/stores/user", () => ({
  useUserStore: () => ({ organizations: [], activeOrganizationId: "org-1" }),
}));

import { provideWebchatSettings } from "../composables/useWebchatSettings";
import WebchatAppearanceTab from "../components/webchat/WebchatAppearanceTab.vue";
import WebchatTilePicker from "../components/webchat/WebchatTilePicker.vue";
import WebchatChoiceChips from "../components/webchat/WebchatChoiceChips.vue";
import WebchatIcon from "../components/webchat/WebchatIcon.vue";

const settings = {
  isEnabled: true,
  brandColor: "#14532d",
  brandColorSource: "custom",
  brandPalette: [],
  logoUrl: null,
  logoSource: null,
  themeMode: "light",
  position: "right",
  launcherIcon: "chat",
  launcherIconStyle: "outline",
  launcherIconUrl: null,
  widgetTitle: "Chat with us",
  homeHeading: null,
  showGreeting: true,
  greetingMessage: null,
  teaserMessage: null,
  csatEnabled: true,
  csatQuestion: null,
  preChatForm: null,
  allowedDomains: [],
  pageTools: { enabled: false, allowedOrigins: [] },
  spamClassifierEnabled: false,
  spamGuidance: null,
  lastSeenAt: null,
  lastSeenOrigin: null,
  underAttack: { active: false, until: null, source: null },
  underAttackHours: 4,
};

async function mountTab() {
  let state!: ReturnType<typeof provideWebchatSettings>;
  const Host = defineComponent({
    setup() {
      state = provideWebchatSettings();
      return () => h(WebchatAppearanceTab);
    },
  });
  const wrapper = mountWithStubs(Host, {
    stubs: { WebchatTilePicker, WebchatChoiceChips, WebchatIcon, NuxtLink: true, Label: true },
  });
  await state.load();
  await flushPromises();
  return { wrapper, state };
}

const radio = (wrapper: Awaited<ReturnType<typeof mountTab>>["wrapper"], testId: string) =>
  wrapper.find(`[data-testid="${testId}"] input`);

describe("Webchat appearance: button and assistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubNuxtGlobals();
    api.getSettings.mockResolvedValue(settings);
    api.orgSettings.mockResolvedValue({ website: null });
    api.getAssistant.mockResolvedValue({ name: "Ava", avatarUrl: null, avatarPreset: "sparkle" });
    api.removeAvatar.mockResolvedValue({});
  });

  it("offers the preset button icons; the uploaded one only once there is one", async () => {
    const { wrapper } = await mountTab();
    for (const icon of ["chat", "robot", "question", "lifebuoy", "headset", "bubble"]) {
      expect(radio(wrapper, `webchat-button-icon-${icon}`).exists()).toBe(true);
    }
    expect(radio(wrapper, "webchat-button-icon-custom").exists()).toBe(false);
  });

  it("hides the outline/filled choice for icons drawn one way only", async () => {
    const { wrapper } = await mountTab();
    const styleChips = () => wrapper.find('input[name="webchat-button-icon-style"]');
    await radio(wrapper, "webchat-button-icon-lifebuoy").trigger("change");
    expect(styleChips().exists()).toBe(true);
    await radio(wrapper, "webchat-button-icon-headset").trigger("change");
    expect(styleChips().exists()).toBe(false);
  });

  it("picking a button icon and style edits the form", async () => {
    const { wrapper, state } = await mountTab();
    await radio(wrapper, "webchat-button-icon-sparkle").trigger("change");
    await wrapper.find('input[name="webchat-button-icon-style"][value="filled"]').trigger("change");
    expect(state.form.value).toMatchObject({
      launcherIcon: "sparkle",
      launcherIconStyle: "filled",
    });
    expect(state.isDirty.value).toBe(true);
  });

  it("picking an icon for the assistant edits the form", async () => {
    const { wrapper, state } = await mountTab();
    await radio(wrapper, "webchat-assistant-avatar-robot").trigger("change");
    expect(state.form.value.assistantAvatarPreset).toBe("robot");
    expect(api.removeAvatar).not.toHaveBeenCalled();
  });

  it("with a picture, picking an icon removes the picture so the icon shows", async () => {
    api.getAssistant.mockResolvedValue({
      name: "Ava",
      avatarUrl: "/uploads/org-1/avatars/ava.png",
      avatarPreset: "sparkle",
    });
    const { wrapper, state } = await mountTab();
    expect(radio(wrapper, "webchat-assistant-avatar-upload").exists()).toBe(true);
    expect(
      wrapper.find('[data-testid="webchat-assistant-avatar-upload"] img').attributes("src"),
    ).toBe("https://api.hay.test/uploads/org-1/avatars/ava.png");

    await radio(wrapper, "webchat-assistant-avatar-sparkles").trigger("change");
    await flushPromises();
    expect(api.removeAvatar).toHaveBeenCalled();
    expect(state.form.value.assistantAvatarPreset).toBe("sparkles");
  });
});
