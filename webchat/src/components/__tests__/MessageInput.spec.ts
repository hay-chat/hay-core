import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import MessageInput from "../MessageInput.vue";

describe("MessageInput refused-send feedback", () => {
  it("shows a friendly notice and puts the text back", async () => {
    const wrapper = mount(MessageInput, { props: { isConnected: true, failure: null } });

    await wrapper.setProps({ failure: { reason: "sendFailed", text: "Do you ship to Lisbon?" } });

    expect(wrapper.get("[role=alert]").text()).toBe(
      "Couldn't send your message. Please try again in a moment.",
    );
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      "Do you ship to Lisbon?",
    );
  });

  it("says when the message is too long", async () => {
    const wrapper = mount(MessageInput, { props: { isConnected: true, failure: null } });
    await wrapper.setProps({ failure: { reason: "messageTooLong", text: "long" } });
    expect(wrapper.get("[role=alert]").text()).toBe(
      "Your message is too long. Please shorten it and try again.",
    );
  });

  it("does not overwrite text typed since the failed send", async () => {
    const wrapper = mount(MessageInput, { props: { isConnected: true, failure: null } });
    await wrapper.get("textarea").setValue("something new");
    await wrapper.setProps({ failure: { reason: "sendFailed", text: "old" } });
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("something new");
  });

  it("shows nothing when there is no failure", () => {
    const wrapper = mount(MessageInput, { props: { isConnected: true, failure: null } });
    expect(wrapper.find("[role=alert]").exists()).toBe(false);
  });
});
