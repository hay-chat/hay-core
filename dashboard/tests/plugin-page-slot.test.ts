// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createTRPCClient, httpLink } from "@trpc/client";

// A real tRPC proxy: any property is a procedure, so String(client) throws.
vi.mock("@/utils/api", () => ({
  Hay: createTRPCClient({ links: [httpLink({ url: "http://api.test/v1" })] }),
}));
vi.mock("@/composables/useDomain", () => ({
  useDomain: () => ({ getApiUrl: () => "http://api.test" }),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ locale: ref("en") }) }));

import PluginPageSlot from "@/components/plugins/PluginPageSlot.vue";

const PLUGIN_ID = "hay-channel-example";
const GLOBAL_VAR = "ExamplePlugin";

/** Pretend the plugin's bundle and stylesheet are already on the page. */
function installBundle(component: unknown) {
  for (const [tag, id] of [
    ["link", `plugin-style-${PLUGIN_ID}`],
    ["script", `plugin-script-${PLUGIN_ID}`],
  ] as const) {
    const el = document.createElement(tag);
    el.id = id;
    document.head.appendChild(el);
  }
  (window as unknown as Record<string, unknown>)[GLOBAL_VAR] = { AfterSettings: component };
}

const stub = (name: string) =>
  defineComponent({
    name,
    setup:
      (_, { slots }) =>
      () =>
        h("div", slots.default?.()),
  });

afterEach(() => {
  document.head.innerHTML = "";
  delete (window as unknown as Record<string, unknown>)[GLOBAL_VAR];
});

describe("PluginPageSlot", () => {
  it("renders a plugin component that does not declare the api prop", async () => {
    installBundle(
      defineComponent({
        props: { locale: { type: String, default: "en" } },
        setup: () => () => h("p", { class: "guide" }, "Setup guide"),
      }),
    );

    const wrapper = mount(PluginPageSlot, {
      props: { pluginId: PLUGIN_ID, componentName: "AfterSettings" },
      global: {
        stubs: {
          Alert: stub("Alert"),
          AlertTitle: stub("AlertTitle"),
          AlertDescription: stub("AlertDescription"),
          Button: stub("Button"),
        },
      },
    });
    await flushPromises();

    expect(wrapper.find(".guide").text()).toBe("Setup guide");
    expect(wrapper.find(".guide").attributes("api")).toBeUndefined();
    expect(wrapper.text()).not.toContain("Loading plugin component");
  });
});
