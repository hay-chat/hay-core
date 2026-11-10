// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, onMounted, ref, watch } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, stubNuxtGlobals } from "./component-harness";

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/utils/api", () => ({
  Hay: {
    organizations: { getSettings: { query: api.getSettings } },
    customerPrivacy: { listRequests: { query: api.list } },
  },
  HayApi: {},
}));
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/composables/useFileUpload", () => ({
  useFileUpload: () => ({
    isUploading: { value: false },
    error: { value: null },
    preview: { value: null },
  }),
}));
vi.mock("@/stores/user", () => ({ useUserStore: () => ({ isAdmin: true }) }));

import GeneralSettings from "../pages/settings/general.vue";
import CustomerPrivacy from "../pages/settings/customer-privacy.vue";

const passThrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h("div", attrs, slots.default?.());
  },
});
const stubs = {
  Alert: passThrough,
  AlertTitle: passThrough,
  AlertDescription: passThrough,
  Select: passThrough,
  SelectTrigger: true,
  SelectValue: true,
  SelectContent: true,
  SelectItem: true,
  Checkbox: true,
  DeleteOrganizationDialog: true,
  SettingsTabs: true,
  OrganizationMfaCard: true,
  CustomerPrivacyRequestsTable: true,
  AiProcessingCard: true,
  AiDisclosureCard: true,
  MediaSettingsCard: true,
};
const saved = {
  name: "Acme",
  defaultLanguage: "en",
  timezone: "UTC",
  dateFormat: "YYYY-MM-DD",
  timeFormat: "24h",
  retentionDays: 90,
};
const saveButton = (wrapper: ReturnType<typeof mountWithStubs>, key: string) =>
  wrapper.findAll("button").find((b) => b.text().includes(key));

describe("settings pages after a failed load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubNuxtGlobals();
    // general.vue relies on Nuxt's auto-imported Vue helpers.
    vi.stubGlobal("ref", ref);
    vi.stubGlobal("computed", computed);
    vi.stubGlobal("watch", watch);
    vi.stubGlobal("onMounted", onMounted);
    vi.stubGlobal("useLocale", () => ({ setLocaleFromBackend: vi.fn() }));
    api.list.mockResolvedValue([]);
  });

  it("General replaces the form with an error, and retry brings it back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.getSettings.mockRejectedValueOnce(new Error("boom"));
    const wrapper = mountWithStubs(GeneralSettings, { stubs });
    await flushPromises();

    expect(wrapper.find('[data-testid="settings-load-error"]').exists()).toBe(true);
    expect(saveButton(wrapper, "general.saveChanges")).toBeUndefined();

    api.getSettings.mockResolvedValueOnce(saved);
    await saveButton(wrapper, "common.tryAgain")!.trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="settings-load-error"]').exists()).toBe(false);
    expect(saveButton(wrapper, "general.saveChanges")).toBeDefined();
  });

  it("Customer privacy blocks saving retention until the policy has loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.getSettings.mockRejectedValueOnce(new Error("boom"));
    const wrapper = mountWithStubs(CustomerPrivacy, { stubs });
    await flushPromises();

    const save = () => saveButton(wrapper, "customerPrivacy.saveRetentionPolicy")!;
    expect(wrapper.find('[data-testid="retention-load-error"]').exists()).toBe(true);
    expect(save().attributes("disabled")).toBeDefined();

    api.getSettings.mockResolvedValueOnce(saved);
    await saveButton(wrapper, "common.tryAgain")!.trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="retention-load-error"]').exists()).toBe(false);
    expect(save().attributes("disabled")).toBeUndefined();
  });
});
