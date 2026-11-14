// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, stubNuxtGlobals } from "../component-harness";
import { article, buttonWith, collection, helpCenter, hubState, stubs } from "./fixtures";

const api = await vi.hoisted(async () => (await import("./fixtures")).createApi());
vi.mock("@/utils/api", async () => (await import("./fixtures")).hayMock(api));
// useUnsavedChanges registers a navigation guard on the real router.
vi.mock("vue-router", () => ({
  useRouter: () => ({ beforeEach: () => () => {}, push: vi.fn() }),
}));

import HelpCenterPage from "../../pages/help-center/index.vue";

async function mountPage() {
  const wrapper = mountWithStubs(HelpCenterPage, { stubs });
  await flushPromises();
  return wrapper;
}

describe("help center hub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubNuxtGlobals();
    api.checkSubdomain.mockResolvedValue({ available: true });
    api.listCollections.mockResolvedValue([]);
    api.listDocuments.mockResolvedValue({ items: [], pagination: { totalPages: 1 } });
    api.getPreviewLink.mockResolvedValue({
      baseUrl: "https://acme.help.example.com",
      token: "123.sig",
    });
  });

  it("explains that the server has no help center domain, with no controls", async () => {
    api.get.mockResolvedValue({
      enabled: false,
      baseDomain: "",
      suggestedSubdomain: "",
      helpCenter: null,
    });
    const wrapper = await mountPage();

    const disabled = wrapper.find('[data-testid="help-center-disabled"]');
    expect(disabled.text()).toContain("helpCenter.disabled.title");
    expect(disabled.text()).toContain("helpCenter.disabled.description");
    expect(wrapper.findAll("button, input, select")).toHaveLength(0);
    expect(api.listCollections).not.toHaveBeenCalled();
  });

  it("offers the setup wizard, with the suggested address, when there is no help center", async () => {
    api.get.mockResolvedValue(hubState(null));
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="help-center-setup"]').exists()).toBe(true);
    const address = wrapper.find<HTMLInputElement>("#hc-subdomain");
    expect(address.element.value).toBe("acme");
    expect(wrapper.text()).toContain(".help.example.com");
    expect(wrapper.text()).toContain("helpCenter.setup.basics.title");
  });

  it("shows an existing help center as offline, with its address and tabs", async () => {
    api.get.mockResolvedValue(hubState(helpCenter()));
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="status"]').text()).toBe("helpCenter.offline");
    expect(wrapper.find('[data-testid="not-live-notice"]').exists()).toBe(true);
    expect(wrapper.find('a[href="https://acme.help.example.com"]').exists()).toBe(true);
    for (const tab of ["overview", "content", "appearance", "domain"]) {
      expect(buttonWith(wrapper, `helpCenter.tabs.${tab}`)).toBeDefined();
    }
    expect(buttonWith(wrapper, "helpCenter.overview.preview")!.attributes("href")).toBe(
      "https://acme.help.example.com/?hc_preview=123.sig",
    );
  });

  it("replaces the page with an error and a retry when loading fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.get.mockRejectedValueOnce(new Error("boom"));
    const wrapper = await mountPage();
    expect(wrapper.find('[data-testid="help-center-load-error"]').exists()).toBe(true);

    api.get.mockResolvedValue(hubState(helpCenter()));
    await buttonWith(wrapper, "helpCenter.tryAgain")!.trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="status"]').exists()).toBe(true);
  });

  it("goes live only after a confirmation that says how many articles become public", async () => {
    api.get.mockResolvedValue(hubState(helpCenter()));
    api.listCollections.mockResolvedValue([
      collection("a", [article("d1"), article("d2"), article("d3", false)]),
    ]);
    api.setPublished.mockResolvedValue(helpCenter({ isPublished: true }));
    const wrapper = await mountPage();

    await buttonWith(wrapper, "helpCenter.overview.goLive")!.trigger("click");
    expect(api.setPublished).not.toHaveBeenCalled();
    const dialog = wrapper.find('[data-stub="ConfirmDialog"]');
    expect(dialog.text()).toContain("helpCenter.overview.goLiveDescription");
    expect(dialog.text()).toContain('"count":2');

    await dialog.find('[data-testid="confirm"]').trigger("click");
    await flushPromises();

    expect(api.setPublished).toHaveBeenCalledWith({ published: true });
    expect(wrapper.find('[data-testid="status"]').text()).toBe("helpCenter.live");
    expect(wrapper.find('[data-testid="not-live-notice"]').exists()).toBe(false);
  });
});
