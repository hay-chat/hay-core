// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, stubNuxtGlobals } from "./component-harness";

const api = vi.hoisted(() => ({ getSettings: vi.fn(), getAssistant: vi.fn() }));
vi.mock("@/utils/api", () => ({
  Hay: {
    webchat: { getSettings: { query: api.getSettings } },
    organizations: { assistant: { get: { query: api.getAssistant } } },
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
import WebchatPreview from "../components/webchat/WebchatPreview.vue";

async function mountPreview() {
  let state!: ReturnType<typeof provideWebchatSettings>;
  const Host = defineComponent({
    setup() {
      state = provideWebchatSettings();
      return () => h(WebchatPreview);
    },
  });
  const wrapper = mountWithStubs(Host, { attachTo: document.body });
  await state.load();
  await flushPromises();
  vi.advanceTimersByTime(5000);
  await nextTick();
  return { wrapper, state };
}

const shown = (wrapper: Awaited<ReturnType<typeof mountPreview>>["wrapper"]) =>
  wrapper.findAll('[data-testid="webchat-preview-frame"]');
const next = (wrapper: Awaited<ReturnType<typeof mountPreview>>["wrapper"]) =>
  wrapper.find('[data-testid="webchat-preview-frame-next"]');

/** What widget.js posts from inside the frame once it has painted. */
function ready(frame: HTMLIFrameElement) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "hay-webchat:preview-ready" },
      source: frame.contentWindow,
    }),
  );
}

describe("Webchat preview: no blank frame on edits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubNuxtGlobals();
    api.getSettings.mockResolvedValue({
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
      lastSeenAt: null,
      underAttack: { active: false, until: null, source: null },
    });
    api.getAssistant.mockResolvedValue({ name: "Ava", avatarUrl: null, avatarPreset: "sparkle" });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("keeps the shown frame up and swaps the new one in once the widget has painted", async () => {
    const { wrapper, state } = await mountPreview();
    const before = shown(wrapper)[0]!.attributes("srcdoc");
    expect(next(wrapper).exists()).toBe(false);

    state.form.value.brandColor = "#7c3aed";
    await nextTick();
    expect(wrapper.find('[data-testid="webchat-preview-updating"]').exists()).toBe(true);
    vi.advanceTimersByTime(400);
    await nextTick();

    // The new render loads under the shown one.
    expect(shown(wrapper)[0]!.attributes("srcdoc")).toBe(before);
    expect(next(wrapper).attributes("srcdoc")).toContain("#7c3aed");

    ready(next(wrapper).element as HTMLIFrameElement);
    await nextTick();
    vi.advanceTimersByTime(250);
    await nextTick();
    expect(next(wrapper).exists()).toBe(false);
    expect(shown(wrapper)).toHaveLength(1);
    expect(shown(wrapper)[0]!.attributes("srcdoc")).toContain("#7c3aed");
    expect(wrapper.find('[data-testid="webchat-preview-updating"]').exists()).toBe(false);
  });

  it("ignores ready messages from other frames, then swaps anyway after a timeout", async () => {
    const { wrapper, state } = await mountPreview();
    state.form.value.brandColor = "#7c3aed";
    await nextTick();
    vi.advanceTimersByTime(400);
    await nextTick();

    ready(shown(wrapper)[0]!.element as HTMLIFrameElement);
    await nextTick();
    expect(next(wrapper).exists()).toBe(true);

    vi.advanceTimersByTime(4000);
    await nextTick();
    vi.advanceTimersByTime(250);
    await nextTick();
    expect(next(wrapper).exists()).toBe(false);
    expect(shown(wrapper)[0]!.attributes("srcdoc")).toContain("#7c3aed");
  });

  it("switching the preview's own state renders straight away", async () => {
    const { wrapper } = await mountPreview();
    const chat = wrapper.findAll("button").find((b) => b.text() === "webchat.preview.states.chat");
    await chat!.trigger("click");
    expect(next(wrapper).attributes("srcdoc")).toContain('"state":"chat"');
  });
});
