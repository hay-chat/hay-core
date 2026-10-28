import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import MessageInput from "../MessageInput.vue";
import { provideI18n } from "@/i18n";

/** D8-9: the paperclip sends the picked file with what was typed as its caption. */

describe("MessageInput paperclip", () => {
  it("emits the file and the typed caption, then clears the input", async () => {
    const emitted: Array<[File, string]> = [];
    const Root = defineComponent({
      setup() {
        provideI18n();
        return () =>
          h(MessageInput, {
            isReady: true,
            onAttach: (file: File, caption: string) => emitted.push([file, caption]),
          });
      },
    });
    const wrapper = mount(Root);
    await wrapper.find("textarea").setValue("Broken on arrival");

    const input = wrapper.find('input[type="file"]');
    const file = new File(["abc"], "box.jpg", { type: "image/jpeg" });
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });
    await input.trigger("change");

    expect(emitted).toEqual([[file, "Broken on arrival"]]);
    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("");
    expect(wrapper.find(".hay-message-input__attach").attributes("aria-label")).toBe(
      "Attach a photo or PDF",
    );
  });
});
