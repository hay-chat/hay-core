// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, onMounted, onUnmounted } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, route, router, stubNuxtGlobals, toast } from "../component-harness";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  setupStatus: vi.fn(),
  initiate: vi.fn(),
  connect: vi.fn(),
  configure: vi.fn(),
}));
vi.mock("@/utils/api", () => ({
  Hay: {
    plugins: {
      get: { query: api.get },
      setupStatus: { query: api.setupStatus },
      configure: { mutate: api.configure },
      oauth: { initiate: { mutate: api.initiate } },
    },
  },
  HayApi: {},
}));
vi.mock("@/composables/useDomain", () => ({
  useDomain: () => ({ getApiUrl: (path = "") => `http://api${path}` }),
}));
vi.mock("@/composables/useToast", () => ({ useToast: () => toast }));
vi.mock("@/composables/usePluginConnect", () => ({
  usePluginConnect: () => ({ connect: api.connect }),
}));
vi.mock("@/composables/usePluginTranslations", () => ({
  usePluginTranslations: () => ({ loadTranslations: vi.fn() }),
}));
vi.mock("@/composables/useToolLabel", () => ({
  useToolLabel: () => ({
    getToolLabel: (_: string, name: string) => name,
    getToolDescription: () => "",
    getPluginName: () => "Stripe",
    getPluginDescription: () => "",
    getSetupStepText: () => "",
  }),
}));

import PluginPage from "../../pages/integrations/plugins/[pluginId].vue";

const stripe = {
  id: "hay-plugin-stripe",
  name: "Stripe",
  enabled: true,
  oauthAvailable: false,
  capabilities: [],
  metadata: { configSchema: { apiKey: { type: "string", required: true, encrypted: true } } },
  configuration: {},
};

const RETURN_TO = "/setup?plugin=hay-plugin-stripe";
const PluginConfigForm = defineComponent({
  name: "PluginConfigForm",
  emits: ["submit"],
  setup:
    (_, { emit }) =>
    () =>
      h("button", { "data-testid": "save", onClick: () => emit("submit") }),
});
const mountPage = () => mountWithStubs(PluginPage, { stubs: { PluginConfigForm } });
const saved = { ...stripe, configuration: { apiKey: "********" } };

describe("connect link for a plugin without OAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    stubNuxtGlobals();
    vi.stubGlobal("onMounted", onMounted);
    vi.stubGlobal("onUnmounted", onUnmounted);
    vi.stubGlobal("useI18n", () => ({
      t: (key: string) => key,
      locale: { value: "en" },
    }));
    Object.assign(route, {
      path: "/integrations/plugins/hay-plugin-stripe",
      params: { pluginId: "hay-plugin-stripe" },
      query: {
        connect: "1",
        return_to: `${window.location.origin}${RETURN_TO}`,
      },
    });
    api.get.mockResolvedValue(stripe);
    api.setupStatus.mockResolvedValue(null);
    api.connect.mockResolvedValue(true);
  });
  afterEach(() => {
    route.query = {};
    vi.unstubAllGlobals();
  });

  it("leaves the spinner for the plugin's settings instead of spinning forever", async () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("pluginSettings.connect.saving");

    await flushPromises();
    expect(api.connect).toHaveBeenCalledTimes(1);
    expect(api.initiate).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain("pluginSettings.connect.saving");
    expect(router.replace).toHaveBeenCalledWith({
      path: route.path,
      query: { return_to: route.query.return_to },
    });
    // Nothing was configured by the link, so nothing claims to be saved, and the way back stays.
    expect(toast.success).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("pluginSettings.backToSetup");
    wrapper.unmount();
  });

  it("goes back to setup once the key is saved", async () => {
    const wrapper = mountPage();
    await flushPromises();
    api.configure.mockResolvedValue({});
    api.get.mockResolvedValue(saved);
    await wrapper.get('[data-testid="save"]').trigger("click");
    await flushPromises();
    expect(router.push).toHaveBeenCalledWith(`${RETURN_TO}&hay_connect=success`);
  });

  it("stays when the save fails", async () => {
    const wrapper = mountPage();
    await flushPromises();
    api.configure.mockRejectedValue(new Error("Invalid key"));
    await wrapper.get('[data-testid="save"]').trigger("click");
    await flushPromises();
    expect(router.push).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("stays when a required field is still empty", async () => {
    const wrapper = mountPage();
    await flushPromises();
    api.configure.mockResolvedValue({});
    await wrapper.get('[data-testid="save"]').trigger("click");
    await flushPromises();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("stays without return_to, or when it points anywhere but setup", async () => {
    for (const query of [{}, { return_to: "https://evil.example/setup" }]) {
      route.query = query;
      const wrapper = mountPage();
      await flushPromises();
      api.configure.mockResolvedValue({});
      api.get.mockResolvedValue(saved);
      await wrapper.get('[data-testid="save"]').trigger("click");
      await flushPromises();
      expect(router.push).not.toHaveBeenCalled();
      wrapper.unmount();
    }
  });
});
