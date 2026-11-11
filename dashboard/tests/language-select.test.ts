// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";

import { filterLanguageOptions, languageOptions } from "../utils/languages";

// jsdom lacks what the popover positions itself with.
Element.prototype.scrollIntoView = vi.fn();
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const locale = ref("en");
vi.stubGlobal("useI18n", () => ({ locale, t: (key: string) => key }));
const { default: LanguageSelect } = await import("../components/LanguageSelect.vue");

describe("language options", () => {
  it("are named and sorted in the display language", () => {
    const names = languageOptions(["de", "pt", "en"], "pt-BR").map((option) => option.name);
    expect(names).toEqual(["alemão", "inglês", "português (Brasil)"]);
  });

  it("are found by localized name, English name or code, ignoring case and accents", () => {
    const options = languageOptions(["de", "pt", "pt-PT", "en"], "pt-BR");
    const codes = (query: string) => filterLanguageOptions(options, query).map((o) => o.code);

    expect(codes("alema")).toEqual(["de"]);
    expect(codes("German")).toEqual(["de"]);
    expect(codes("PT-pt")).toEqual(["pt-PT"]);
    expect(codes("portugues")).toEqual(["pt", "pt-PT"]);
    expect(codes("  ")).toHaveLength(4);
  });
});

const mountSelect = (props: Record<string, unknown>) =>
  mount(LanguageSelect, {
    props,
    attachTo: document.body,
    global: { mocks: { $t: (key: string) => key } },
  });

// Not flushPromises: the popover's positioning keeps scheduling timers in jsdom.
const settle = async () => {
  for (let i = 0; i < 5; i++) await nextTick();
};

const openList = async (wrapper: ReturnType<typeof mountSelect>) => {
  await wrapper.find("button").trigger("click");
  await settle();
};

const listedNames = () =>
  Array.from(document.body.querySelectorAll('[role="option"]')).map((el) => el.textContent?.trim());

describe("LanguageSelect", () => {
  it("shows the selected language by name and helper text", () => {
    const wrapper = mountSelect({ modelValue: "de", label: "Language", helperText: "Helps" });
    const trigger = wrapper.find("button");
    const [labelId, valueId] = trigger.attributes("aria-labelledby")!.split(" ");
    expect(wrapper.find(`#${labelId}`).text()).toBe("Language");
    expect(wrapper.find(`#${valueId}`).text()).toBe("German");
    expect(trigger.attributes("tabindex")).toBe("0");
    expect(wrapper.text()).toContain("Helps");
    wrapper.unmount();
  });

  it("offers only the given codes and filters them by the search", async () => {
    const wrapper = mountSelect({ modelValue: "en", codes: ["en", "de", "fr"] });
    await openList(wrapper);
    expect(listedNames()).toEqual(["English", "French", "German"]);

    const search = document.body.querySelector("input") as HTMLInputElement;
    expect(document.activeElement).toBe(search);
    search.value = "GERM";
    search.dispatchEvent(new Event("input"));
    await settle();
    expect(listedNames()).toEqual(["German"]);
    wrapper.unmount();
  });

  it("emits the picked code, and null for the none choice", async () => {
    const wrapper = mountSelect({
      modelValue: "fr",
      codes: ["en", "fr"],
      allowNone: true,
      noneLabel: "Don't translate",
    });
    await openList(wrapper);
    expect(listedNames()[0]).toBe("Don't translate");

    const options = () => Array.from(document.body.querySelectorAll('[role="option"]'));
    (options()[1] as HTMLElement).click();
    await settle();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["en"]);

    await openList(wrapper);
    (options()[0] as HTMLElement).click();
    await settle();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([null]);
    wrapper.unmount();
  });

  it("shows the none label when nothing is selected", () => {
    const wrapper = mountSelect({ modelValue: null, allowNone: true, noneLabel: "Off" });
    expect(wrapper.find("button").text()).toContain("Off");
    wrapper.unmount();
  });
});
