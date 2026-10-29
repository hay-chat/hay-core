import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import CsatRating from "../CsatRating.vue";
import { provideI18n } from "@/i18n";

/**
 * CSAT: the shopper rates the support 1-5 once the conversation has ended.
 */

function mountRating(submit: (rating: number) => Promise<boolean>, submitted = false) {
  const Root = defineComponent({
    setup() {
      provideI18n();
      return () => h(CsatRating, { question: "How did we do?", submitted, submit });
    },
  });
  return mount(Root);
}

describe("CsatRating", () => {
  it("submits the picked rating", async () => {
    const submit = vi.fn(async () => true);
    const wrapper = mountRating(submit);
    expect(wrapper.text()).toContain("How did we do?");
    await wrapper.findAll(".hay-csat__option")[3].trigger("click");
    expect(submit).toHaveBeenCalledWith(4);
  });

  it("lets the shopper pick again when the submit fails", async () => {
    const submit = vi.fn(async () => false);
    const wrapper = mountRating(submit);
    await wrapper.findAll(".hay-csat__option")[0].trigger("click");
    await flushPromises();
    const options = wrapper.findAll(".hay-csat__option");
    expect(options.every((o) => o.attributes("disabled") === undefined)).toBe(true);
    expect(wrapper.find(".hay-csat__option--selected").exists()).toBe(false);
    await options[4].trigger("click");
    expect(submit).toHaveBeenLastCalledWith(5);
  });

  it("shows the thank-you once rated", () => {
    const wrapper = mountRating(async () => true, true);
    expect(wrapper.find(".hay-csat__scale").exists()).toBe(false);
    expect(wrapper.find(".hay-csat__thanks").exists()).toBe(true);
  });
});
