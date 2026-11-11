// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { stubNuxtGlobals, uiStubs, translate } from "./component-harness";
import type { DisplayTranslation } from "../composables/useMessageTranslations";

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: translate, locale: ref("en") }) }));

const approveMessage = vi.fn();
const blockMessage = vi.fn();
vi.mock("@/composables/useMessageApproval", () => ({
  useMessageApproval: () => ({ approveMessage, blockMessage, loading: ref(false) }),
}));

/** Renders the footer's named slots, which the shared container stub leaves out. */
const DialogFooter = defineComponent({
  name: "DialogFooter",
  setup(_, { slots }) {
    return () => h("div", [slots.secondary?.(), slots.primary?.()]);
  },
});
const passthrough = (name: string) =>
  defineComponent({
    name,
    inheritAttrs: false,
    setup(_, { slots, attrs }) {
      return () => h("div", attrs, slots.default?.());
    },
  });

const english: DisplayTranslation = {
  text: "Your order ships tomorrow.",
  sourceLanguage: "pt",
  language: "en",
};

async function render(translation: DisplayTranslation | null) {
  const { default: MessageApprovalDialog } =
    await import("../components/MessageApprovalDialog.vue");
  const wrapper = mount(MessageApprovalDialog, {
    props: {
      open: false,
      messageId: "m1",
      originalContent: "Seu pedido será enviado amanhã.",
      translation,
    },
    global: {
      stubs: {
        ...uiStubs,
        DialogFooter,
        Alert: passthrough("Alert"),
        AlertTitle: passthrough("AlertTitle"),
        AlertDescription: passthrough("AlertDescription"),
        Check: true,
        Ban: true,
      },
    },
  });
  await wrapper.setProps({ open: true });
  return wrapper;
}

const editor = (wrapper: Awaited<ReturnType<typeof render>>) => wrapper.get("input");
const approveButton = (wrapper: Awaited<ReturnType<typeof render>>) =>
  wrapper.findAll("button").find((b) => b.text().includes("draftApproval.approve"))!;

describe("MessageApprovalDialog", () => {
  beforeEach(() => {
    stubNuxtGlobals();
    approveMessage.mockReset();
    blockMessage.mockReset();
  });

  it("edits in the reviewer's language and sends that language with the edit", async () => {
    approveMessage.mockResolvedValue({});
    const wrapper = await render(english);

    expect((editor(wrapper).element as HTMLInputElement).value).toBe("Your order ships tomorrow.");
    expect(editor(wrapper).attributes("aria-label")).toContain("approvalEditLabel");
    expect(wrapper.get('[data-testid="approval-customer-version"]').text()).toContain(
      "Seu pedido será enviado amanhã.",
    );

    await editor(wrapper).setValue("Your order ships on Tuesday.");
    await approveButton(wrapper).trigger("click");
    await flushPromises();

    expect(approveMessage).toHaveBeenCalledWith("m1", "Your order ships on Tuesday.", "en");
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("approves an unchanged reply as is", async () => {
    approveMessage.mockResolvedValue({});
    const wrapper = await render(english);

    await approveButton(wrapper).trigger("click");
    await flushPromises();

    expect(approveMessage).toHaveBeenCalledWith("m1", undefined, undefined);
  });

  it("offers approving the original or editing untranslated when translation fails", async () => {
    approveMessage.mockRejectedValueOnce(new Error("TRANSLATION_FAILED"));
    const wrapper = await render(english);

    await editor(wrapper).setValue("Your order ships on Tuesday.");
    await approveButton(wrapper).trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="approval-translation-failed"]').exists()).toBe(true);
    expect(wrapper.emitted("update:open")).toBeUndefined();

    await wrapper.get('[data-testid="approval-edit-untranslated"]').trigger("click");
    expect((editor(wrapper).element as HTMLInputElement).value).toBe(
      "Seu pedido será enviado amanhã.",
    );
    expect(wrapper.find('[data-testid="approval-translation"]').exists()).toBe(true);

    approveMessage.mockResolvedValue({});
    await editor(wrapper).setValue("Seu pedido sai na terça.");
    await approveButton(wrapper).trigger("click");
    await flushPromises();
    expect(approveMessage).toHaveBeenLastCalledWith("m1", "Seu pedido sai na terça.", undefined);
  });

  it("approves the original after a failed translation", async () => {
    approveMessage.mockRejectedValueOnce(new Error("TRANSLATION_FAILED"));
    const wrapper = await render(english);
    await editor(wrapper).setValue("Your order ships on Tuesday.");
    await approveButton(wrapper).trigger("click");
    await flushPromises();

    approveMessage.mockResolvedValue({});
    await wrapper.get('[data-testid="approval-approve-original"]').trigger("click");
    await flushPromises();

    expect(approveMessage).toHaveBeenLastCalledWith("m1", undefined, undefined);
    expect(wrapper.emitted("approved")).toEqual([["m1", undefined]]);
  });

  it("edits the original when the reviewer has no translation", async () => {
    approveMessage.mockResolvedValue({});
    const wrapper = await render(null);

    expect((editor(wrapper).element as HTMLInputElement).value).toBe(
      "Seu pedido será enviado amanhã.",
    );
    await editor(wrapper).setValue("Seu pedido sai na terça.");
    await approveButton(wrapper).trigger("click");
    await flushPromises();

    expect(approveMessage).toHaveBeenCalledWith("m1", "Seu pedido sai na terça.", undefined);
  });
});
