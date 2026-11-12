import { describe, it, expect } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import WaitingBanner from "../WaitingBanner.vue";
import { provideI18n } from "@/i18n";

/**
 * D5-8 / D5-10: the waiting banner asks for an email, then folds to one line
 * once it is saved or the visitor carries on chatting; a tap opens it again.
 */

function render() {
  const count = ref(1);
  const saved = ref(false);
  const Root = defineComponent({
    setup() {
      provideI18n();
      return () =>
        h(WaitingBanner, {
          typical: "usually ~5 min",
          detail: null,
          contactSaved: saved.value,
          saveEmail: async () => true,
          visitorMessageCount: count.value,
        });
    },
  });
  return { wrapper: mount(Root), count, saved };
}

describe("WaitingBanner", () => {
  it("shows the title with the usual wait and the email form", () => {
    const { wrapper } = render();
    expect(wrapper.find(".hay-waiting__title").text()).toBe(
      "Waiting for a person · usually ~5 min",
    );
    expect(wrapper.find("input[type=email]").exists()).toBe(true);
  });

  it("fills the Notify me button only once the email looks valid", async () => {
    const { wrapper } = render();
    const button = () => wrapper.find(".hay-waiting__button");
    expect(button().classes()).not.toContain("hay-waiting__button--ready");
    expect(button().attributes("disabled")).toBeUndefined();
    await wrapper.find("input").setValue("ana@shop.com");
    expect(button().classes()).toContain("hay-waiting__button--ready");
  });

  it("folds when the visitor sends another message and opens again on tap", async () => {
    const { wrapper, count } = render();
    count.value = 2;
    await wrapper.vm.$nextTick();
    const toggle = wrapper.find(".hay-waiting__toggle");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find("input").exists()).toBe(false);
    await toggle.trigger("click");
    expect(wrapper.find("input").exists()).toBe(true);
  });

  it("folds once the email is saved", async () => {
    const { wrapper, saved } = render();
    saved.value = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".hay-waiting__toggle").exists()).toBe(true);
  });
});
