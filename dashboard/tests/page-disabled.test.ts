// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { h, ref, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import Page from "@/components/ui/Page.vue";

const slots = {
  header: () => h("button", { id: "save" }, "Save"),
  default: () => h("input", { id: "name" }),
};

describe("Page disabled", () => {
  it("stays a plain div on pages that do not use it", () => {
    const wrapper = mount(Page, { slots });
    expect(wrapper.element.tagName).toBe("DIV");
    expect(wrapper.attributes("disabled")).toBeUndefined();
  });

  it("disables header actions and fields while loading, then releases them in place", async () => {
    const loading = ref(true);
    const wrapper = mount({ render: () => h(Page, { disabled: loading.value }, slots) });
    const fieldset = wrapper.element as HTMLFieldSetElement;

    expect(fieldset.tagName).toBe("FIELDSET");
    expect(fieldset.disabled).toBe(true);
    expect(fieldset.contains(wrapper.find("#save").element)).toBe(true);
    expect(fieldset.contains(wrapper.find("#name").element)).toBe(true);

    const input = wrapper.find("#name").element;
    loading.value = false;
    await nextTick();

    // Same nodes: finishing the load must not remount the form.
    expect(wrapper.element).toBe(fieldset);
    expect(wrapper.find("#name").element).toBe(input);
    expect(fieldset.disabled).toBe(false);
  });
});
