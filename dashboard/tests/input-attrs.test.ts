// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import Input from "../components/ui/Input.vue";

const stubs = {
  Label: { props: ["for"], template: '<label :for="$props.for"><slot /></label>' },
};

const mountInput = (props: Record<string, unknown>, attrs: Record<string, unknown>) =>
  mount(Input, { props, attrs, global: { stubs }, attachTo: document.body });

describe("Input attributes", () => {
  it("puts a caller's id on the control only, and the label points at it", () => {
    const wrapper = mountInput({ label: "Code", modelValue: "" }, { id: "mfa-code" });
    expect(document.querySelectorAll("#mfa-code")).toHaveLength(1);
    expect(wrapper.find("input").attributes("id")).toBe("mfa-code");
    expect(wrapper.find("label").attributes("for")).toBe("mfa-code");
    wrapper.unmount();
  });

  it("calls a keyboard listener once, not again as the event bubbles", async () => {
    const onKeydown = vi.fn();
    const wrapper = mountInput({ modelValue: "" }, { onKeydown });
    await wrapper.find("input").trigger("keydown", { key: "Enter" });
    expect(onKeydown).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("gives a checkbox the caller's id once and keeps other attributes on the wrapper", () => {
    const wrapper = mountInput(
      { type: "checkbox", modelValue: false },
      { id: "terms", "data-testid": "terms-field" },
    );
    expect(document.querySelectorAll("#terms")).toHaveLength(1);
    expect(wrapper.find("input").attributes("id")).toBe("terms");
    expect(wrapper.attributes("data-testid")).toBe("terms-field");
    wrapper.unmount();
  });
});
