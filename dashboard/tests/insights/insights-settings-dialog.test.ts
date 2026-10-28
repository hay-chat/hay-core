// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, stubNuxtGlobals, toast } from "../component-harness";

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock("@/utils/api", () => ({
  HayApi: {
    insights: {
      getSettings: { query: api.getSettings },
      updateSettings: { mutate: api.updateSettings },
    },
  },
}));

import InsightsSettingsDialog from "../../components/insights/InsightsSettingsDialog.vue";

const settings = {
  thresholds: { minClusterSize: 8, joinThreshold: 0.8, mergeThreshold: 0.9, digestEnabled: false },
  tuning: null,
};

describe("InsightsSettingsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubNuxtGlobals();
    api.getSettings.mockResolvedValue(settings);
    api.updateSettings.mockResolvedValue({});
  });

  it("loads the organization's thresholds when opened", async () => {
    const wrapper = mountWithStubs(InsightsSettingsDialog, { props: { open: false } });
    expect(api.getSettings).not.toHaveBeenCalled();

    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(api.getSettings).toHaveBeenCalledTimes(1);
    const minSize = wrapper.get<HTMLInputElement>(
      'input[aria-label="insights.page.settingsDialog.minClusterSize"]',
    );
    expect(minSize.element.value).toBe("8");
    expect(wrapper.get<HTMLInputElement>("#insights-digest").element.checked).toBe(false);
  });

  it("saves typed numbers (comma decimals, rounded size), then closes", async () => {
    const wrapper = mountWithStubs(InsightsSettingsDialog, { props: { open: false } });
    await wrapper.setProps({ open: true });
    await flushPromises();

    await wrapper
      .get('input[aria-label="insights.page.settingsDialog.minClusterSize"]')
      .setValue("6.6");
    await wrapper
      .get('input[aria-label="insights.page.settingsDialog.joinThreshold"]')
      .setValue("0,84");
    await wrapper
      .get('input[aria-label="insights.page.settingsDialog.mergeThreshold"]')
      .setValue("");
    await wrapper.get("#insights-digest").setValue(true);
    const save = wrapper
      .findAll("button")
      .find((b) => b.text() === "insights.page.settingsDialog.save")!;
    await save.trigger("click");
    await flushPromises();

    expect(api.updateSettings).toHaveBeenCalledWith({
      minClusterSize: 7,
      joinThreshold: 0.84,
      mergeThreshold: undefined,
      digestEnabled: true,
    });
    expect(toast.success).toHaveBeenCalledWith("insights.page.settingsDialog.saved");
    expect(wrapper.emitted("saved")).toHaveLength(1);
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });

  it("keeps the dialog open and says so when saving fails", async () => {
    api.updateSettings.mockRejectedValue(new Error("nope"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mountWithStubs(InsightsSettingsDialog, { props: { open: false } });
    await wrapper.setProps({ open: true });
    await flushPromises();

    const save = wrapper
      .findAll("button")
      .find((b) => b.text() === "insights.page.settingsDialog.save")!;
    await save.trigger("click");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith("insights.page.settingsDialog.error");
    expect(wrapper.emitted("saved")).toBeUndefined();
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });
});
