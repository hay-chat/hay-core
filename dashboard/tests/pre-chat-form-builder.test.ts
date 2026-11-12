// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import type { FormSchema } from "@hay/form-schema";
import { mountWithStubs } from "./component-harness";
import PreChatFormBuilder from "../components/settings/PreChatFormBuilder.vue";

describe("PreChatFormBuilder", () => {
  it("switches the form on and settles, with the parent echoing every value back", async () => {
    const model = ref<FormSchema | null>(null);
    let updates = 0;
    const Parent = defineComponent({
      setup: () => () =>
        h(PreChatFormBuilder, {
          modelValue: model.value,
          "onUpdate:modelValue": (value: FormSchema | null) => {
            updates += 1;
            // A fresh object each time, like a parent that clones its form state.
            model.value = value && (JSON.parse(JSON.stringify(value)) as FormSchema);
          },
        }),
    });
    const wrapper = mountWithStubs(Parent, { stubs: { FormSchemaEditor: true } });

    await wrapper.find("#preChatFormEnabled").setValue(true);
    for (let i = 0; i < 5; i += 1) await nextTick();

    expect(model.value?.fields.map((field) => field.name)).toEqual(["name", "email"]);
    expect(updates).toBe(1);

    await wrapper.find("#preChatFormEnabled").setValue(false);
    await nextTick();
    expect(model.value).toBeNull();
  });
});
