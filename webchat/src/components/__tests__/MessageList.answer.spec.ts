import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import MessageList from "../MessageList.vue";
import { provideI18n } from "@/i18n";
import type { AgentActivity, Message } from "@/types";

/**
 * AI answer extras and delivery (C3): the progress line replaces the typing
 * dots while a tool runs and leaves "✓ {done label}" above the reply; the
 * group's sources sit in a pill under the last bubble; thumbs only on the
 * latest answer; ✓ / ✓✓ / "Seen" on the visitor's last message.
 */

const at = (minute: number) => new Date(2026, 10, 12, 14, minute).getTime();

const visitor = (id: string, minute: number, metadata: Record<string, unknown> = {}): Message => ({
  id,
  sender: "user",
  content: `question ${id}`,
  timestamp: at(minute),
  metadata,
});
const bot = (id: string, minute: number, metadata: Record<string, unknown> = {}): Message => ({
  id,
  sender: "agent",
  agentType: "BotAgent",
  content: `answer ${id}`,
  timestamp: at(minute),
  metadata,
});

const sources = [
  { title: "Delivery times", url: "https://shop.example/delivery" },
  { title: "Bad link", url: "javascript:alert(1)" },
  { title: "Tracking", url: "https://shop.example/tracking" },
];

const loaded = async () => {
  await vi.dynamicImportSettled();
  await flushPromises();
};

function render(props: {
  messages: Message[];
  isTyping?: boolean;
  activity?: AgentActivity | null;
  doneLabels?: Record<string, string>;
  ratings?: Record<string, "up" | "down">;
  readMessageId?: string | null;
  rate?: (id: string, rating: "up" | "down") => void;
}) {
  const Root = defineComponent({
    setup() {
      provideI18n();
      return () => h(MessageList, { isTyping: false, assistantName: "Acme assistant", ...props });
    },
  });
  return mount(Root);
}

describe("MessageList answer extras", () => {
  it("shows the progress line instead of the typing dots while a tool runs", () => {
    const wrapper = render({
      messages: [visitor("v1", 0)],
      isTyping: true,
      activity: { running: true, label: "Checking order #1043…", doneLabel: "Checked" },
    });
    expect(wrapper.find(".hay-progress").text()).toBe("Checking order #1043…");
    expect(wrapper.find(".hay-typing").exists()).toBe(false);
  });

  it("words the server's generic labels in the visitor's language", () => {
    const wrapper = render({
      messages: [visitor("v1", 0), bot("b1", 1)],
      activity: { running: true, label: "Working on it…", doneLabel: "Done" },
      doneLabels: { b1: "Done" },
    });
    expect(wrapper.find(".hay-progress").text()).toBe("Working on it…");
    expect(wrapper.find(".hay-group__done").text()).toBe("Done");
  });

  it("puts the done label above the reply that followed the tool run", () => {
    const wrapper = render({
      messages: [visitor("v1", 0), bot("b1", 1)],
      doneLabels: { b1: "Checked order #1043" },
    });
    expect(wrapper.find(".hay-group--agent .hay-group__done").text()).toBe("Checked order #1043");
  });

  it("lists the group's safe sources once, opening in a new tab", async () => {
    const wrapper = render({
      messages: [visitor("v1", 0), bot("b1", 1, { sources }), bot("b2", 1, { sources })],
    });
    await loaded(); // the extras load on demand
    const pill = wrapper.find(".hay-answer__sources");
    expect(pill.text()).toBe("2 sources");
    expect(pill.attributes("aria-expanded")).toBe("false");
    await pill.trigger("click");
    const links = wrapper.findAll(".hay-answer__links a");
    expect(links.map((a) => a.attributes("href"))).toEqual([
      "https://shop.example/delivery",
      "https://shop.example/tracking",
    ]);
    expect(links[0].attributes("target")).toBe("_blank");
    expect(links[0].attributes("rel")).toBe("noopener");
  });

  it("puts thumbs on the latest AI answer only; the chosen one stays, the other hides", async () => {
    const rate = vi.fn();
    const messages = [visitor("v1", 0), bot("b1", 1), visitor("v2", 2), bot("b2", 3)];
    const wrapper = render({ messages, rate });
    await loaded();
    const groups = wrapper.findAll(".hay-group--agent");
    expect(groups[0].find(".hay-answer__rate").exists()).toBe(false);
    const thumbs = groups[1].findAll(".hay-answer__thumb");
    expect(thumbs.map((b) => b.attributes("aria-label"))).toEqual(["Helpful", "Not helpful"]);
    await thumbs[1].trigger("click");
    expect(rate).toHaveBeenCalledWith("b2", "down");

    const rated = render({ messages, rate, ratings: { b2: "down" } });
    await loaded();
    const chosen = rated.findAll(".hay-answer__thumb");
    expect(chosen).toHaveLength(1);
    expect(chosen[0].attributes("aria-pressed")).toBe("true");
    expect(chosen[0].classes()).toContain("hay-answer__thumb--chosen");
  });

  it("shows no extras row without sources or a way to rate", async () => {
    const wrapper = render({ messages: [visitor("v1", 0), bot("b1", 1)] });
    await loaded();
    expect(wrapper.find(".hay-answer").exists()).toBe(false);
  });

  it("marks the visitor's last message ✓ then ✓✓, with words for screen readers", () => {
    const sending = render({ messages: [visitor("temp-1", 0)] });
    expect(sending.find(".hay-bubble__time").text()).toBe("14:00");

    const received = render({ messages: [visitor("temp-1", 0, { delivery: "received" })] });
    expect(received.find(".hay-bubble__time").text()).toBe("14:00✓Sent");
    expect(received.find(".hay-bubble__time .hay-sr-only").text()).toBe("Sent");

    const delivered = render({
      messages: [visitor("v0", 0), visitor("temp-2", 1, { delivery: "delivered" })],
    });
    const times = delivered.findAll(".hay-bubble__time");
    expect(times).toHaveLength(1);
    expect(times[0].text()).toContain("✓✓");
    expect(times[0].find(".hay-sr-only").text()).toBe("Delivered");
  });

  it('says "Seen" under the last visitor message once a person read it', () => {
    const wrapper = render({
      messages: [visitor("temp-1", 0, { serverId: "m-1", delivery: "delivered" })],
      readMessageId: "m-1",
    });
    expect(wrapper.find(".hay-group__seen").text()).toBe("Seen");
    expect(wrapper.find(".hay-bubble__time").text()).toBe("14:00");
  });
});
