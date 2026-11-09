// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, stubNuxtGlobals, toast } from "./component-harness";

const api = vi.hoisted(() => ({
  create: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/utils/api", () => ({
  Hay: {
    sso: {
      createScimToken: { mutate: api.create },
      revokeScimToken: { mutate: api.revoke },
    },
  },
}));

vi.mock("@/composables/useToast", async () => {
  const { toast } = await import("./component-harness");
  return { useToast: () => toast };
});

const baseUrl = "https://api.hay.test/scim/v2";
const existing = {
  prefix: "hay_scim_AbCd",
  createdAt: new Date("2026-11-09T10:00:00Z"),
  lastUsedAt: null,
};

describe("SCIM token card", () => {
  beforeEach(() => {
    stubNuxtGlobals();
    vi.stubGlobal("ref", ref);
    api.create.mockReset();
    api.revoke.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
  });

  async function render(token: typeof existing | null) {
    const { default: Card } = await import("../components/settings/SsoScimCard.vue");
    return mountWithStubs(Card, { props: { baseUrl, token } });
  }

  it("shows the address to enter at the provider and no token before one exists", async () => {
    const wrapper = await render(null);
    expect(wrapper.find("#sso-scim-base-url").text()).toBe(baseUrl);
    expect(wrapper.find("#sso-scim-token").exists()).toBe(false);
    expect(wrapper.text()).toContain("sso.scim.noToken");
    expect(wrapper.text()).toContain("sso.scim.generate");
    expect(wrapper.text()).not.toContain("sso.scim.revoke");
  });

  it("shows a new token once and asks the page to refresh", async () => {
    api.create.mockResolvedValue({ token: "hay_scim_new_value", prefix: "hay_scim_new_" });
    const wrapper = await render(existing);
    expect(wrapper.text()).toContain("sso.scim.replace");
    const generate = wrapper.findAll("button").find((b) => b.text() === "sso.scim.replace");
    await generate!.trigger("click");
    await flushPromises();
    expect(wrapper.find("#sso-scim-token").text()).toBe("hay_scim_new_value");
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("forgets the token it showed when it is revoked", async () => {
    api.create.mockResolvedValue({ token: "hay_scim_gone", prefix: "hay_scim_gone" });
    api.revoke.mockResolvedValue({ success: true });
    const wrapper = await render(existing);
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();
    expect(wrapper.find("#sso-scim-token").exists()).toBe(true);
    const revoke = wrapper.findAll("button").find((b) => b.text() === "sso.scim.revoke");
    await revoke!.trigger("click");
    await flushPromises();
    expect(wrapper.find("#sso-scim-token").exists()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("sso.scim.revoked");
  });

  it("reports a refusal instead of showing a token", async () => {
    api.create.mockRejectedValue(new Error("Step-up required"));
    const wrapper = await render(null);
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith("Step-up required");
    expect(wrapper.find("#sso-scim-token").exists()).toBe(false);
  });
});
