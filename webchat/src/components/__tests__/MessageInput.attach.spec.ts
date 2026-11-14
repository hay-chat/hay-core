import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import MessageInput from "../MessageInput.vue";
import { provideI18n } from "@/i18n";

/**
 * D8-9: the plus button picks a photo or PDF, which waits as a removable chip
 * and goes with the next send, with what was typed as its caption.
 */

function render() {
  const attached: Array<[File, string]> = [];
  const sent: string[] = [];
  const Root = defineComponent({
    setup() {
      provideI18n();
      return () =>
        h(MessageInput, {
          isReady: true,
          onAttach: (file: File, caption: string) => attached.push([file, caption]),
          onSend: (text: string) => sent.push(text),
        });
    },
  });
  return { wrapper: mount(Root), attached, sent };
}

async function pick(wrapper: ReturnType<typeof render>["wrapper"], file: File) {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, "files", { value: [file], configurable: true });
  await input.trigger("change");
}

const send = (wrapper: ReturnType<typeof render>["wrapper"]) => wrapper.find(".hay-composer__send");

describe("MessageInput attachments", () => {
  it("shows the picked file as a chip and sends it with the typed caption", async () => {
    const { wrapper, attached, sent } = render();
    expect(send(wrapper).attributes("disabled")).toBeDefined();

    const file = new File(["abc"], "box.jpg", { type: "image/jpeg" });
    await pick(wrapper, file);
    expect(attached).toEqual([]);
    expect(wrapper.find(".hay-composer__chip").text()).toContain("box.jpg");
    // A file alone can be sent.
    expect(send(wrapper).attributes("disabled")).toBeUndefined();

    await wrapper.find("textarea").setValue("Broken on arrival");
    await send(wrapper).trigger("click");

    expect(attached).toEqual([[file, "Broken on arrival"]]);
    expect(sent).toEqual([]);
    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("");
    expect(wrapper.find(".hay-composer__chip").exists()).toBe(false);
    expect(wrapper.find(".hay-composer__attach").attributes("aria-label")).toBe(
      "Attach a photo or PDF",
    );
  });

  it("removing the chip sends only the text", async () => {
    const { wrapper, attached, sent } = render();
    await pick(wrapper, new File(["abc"], "label.pdf", { type: "application/pdf" }));
    await wrapper.find(".hay-composer__chip-remove").trigger("click");
    expect(wrapper.find(".hay-composer__chip").exists()).toBe(false);

    await wrapper.find("textarea").setValue("Never mind");
    await wrapper.find("textarea").trigger("keydown", { key: "Enter" });
    expect(attached).toEqual([]);
    expect(sent).toEqual(["Never mind"]);
  });
});
