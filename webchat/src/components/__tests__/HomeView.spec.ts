import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import HomeView from "../HomeView.vue";
import { listMyConversations } from "@/utils/visitorConversations";

vi.mock("@/utils/visitorConversations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/visitorConversations")>()),
  listMyConversations: vi.fn(async () => []),
}));
import { provideI18n } from "@/i18n";
import type { VisitorConversation } from "@/types";

/**
 * Home view (question first): heading, status, a message box that starts the
 * chat, the AI disclosure, and "Your conversations" for returning visitors
 * (open first with an "Open" pill, then ended with a date, at most 3).
 */

const row = (
  id: string,
  status: VisitorConversation["status"],
  day: number,
  extra: Partial<VisitorConversation> = {},
): VisitorConversation => ({
  id,
  status,
  lastMessagePreview: `preview ${id}`,
  lastMessageAt: new Date(2026, 9, day, 12).toISOString(),
  lastSenderName: "Acme assistant",
  resumable: true,
  ...extra,
});

function render(props: Record<string, unknown> = {}) {
  const Root = defineComponent({
    setup() {
      provideI18n();
      return () =>
        h(HomeView, {
          title: "Acme Support",
          heading: "How can we help?",
          organizationName: "Acme",
          status: { text: "Typically replies in ~2 min", online: true },
          disclosure: "Answered by our AI assistant.",
          config: { organizationId: "org-1", baseUrl: "https://api.example.test" },
          assistantName: "Acme assistant",
          team: [],
          locale: "en-us",
          ...props,
        });
    },
  });
  return mount(Root);
}

describe("HomeView", () => {
  it("shows the heading, the shop and status, and no list on a first visit", () => {
    const wrapper = render();
    expect(wrapper.find(".hay-home__heading").text()).toBe("How can we help?");
    expect(wrapper.find(".hay-home__status").text()).toBe("Acme · Typically replies in ~2 min");
    expect(wrapper.find(".hay-home__helper").text()).toBe("Answered by our AI assistant.");
    expect(wrapper.find(".hay-home__list").exists()).toBe(false);
    expect(wrapper.find(".hay-home__logo").text()).toBe("A");
  });

  it("asks the server for the visitor's conversations each time it shows", async () => {
    vi.mocked(listMyConversations).mockResolvedValueOnce([row("server", "open", 4)]);
    const wrapper = render({ sampleConversations: undefined });
    await flushPromises();
    expect(listMyConversations).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" }),
    );
    expect(wrapper.findAll(".hay-home__row")).toHaveLength(1);
  });

  it("starts the chat with the typed question", async () => {
    const wrapper = render();
    await wrapper.find("textarea").setValue("Where is my order?");
    await wrapper.find(".hay-composer__send").trigger("click");
    expect(wrapper.findComponent(HomeView).emitted("send")).toEqual([["Where is my order?"]]);
  });

  it("lists open conversations first, then ended ones by date, at most three", () => {
    const wrapper = render({
      sampleConversations: [
        row("ended-old", "closed", 1),
        row("ended-new", "closed", 5),
        row("open", "open", 2, { lastSenderName: "Marina" }),
        row("ended-oldest", "closed", 0),
      ],
    });
    const rows = wrapper.findAll(".hay-home__row");
    expect(rows.map((r) => r.find(".hay-home__row-text").text())).toEqual([
      "Marina: preview open",
      "preview ended-new",
      "preview ended-old",
    ]);
    expect(rows[0].find(".hay-home__pill").text()).toBe("Open");
    expect(rows[1].find(".hay-home__date").text()).toContain("Oct 5");
  });

  it("puts this tab's conversation in the list, even before consent", () => {
    const wrapper = render({
      sampleConversations: [
        row("tab", "open", 1, { lastMessagePreview: "Older text from the server" }),
      ],
      currentThread: {
        id: "tab",
        closed: false,
        messages: [
          { id: "g", sender: "agent", content: "Hello!", timestamp: 1, isGreeting: true },
          { id: "v", sender: "user", content: "Hi  there", timestamp: Date.now() },
        ],
      },
    });
    const rows = wrapper.findAll(".hay-home__row");
    expect(rows).toHaveLength(1);
    expect(rows[0].find(".hay-home__row-text").text()).toBe("You: Hi there");
  });

  it("opens a conversation, or says why one from another device cannot be opened", async () => {
    const wrapper = render({
      sampleConversations: [
        row("here", "open", 3),
        row("elsewhere", "closed", 2, { resumable: false }),
      ],
    });
    const rows = wrapper.findAll(".hay-home__row");
    await rows[0].trigger("click");
    expect(wrapper.findComponent(HomeView).emitted("open")).toEqual([["here"]]);

    await rows[1].trigger("click");
    expect(wrapper.findComponent(HomeView).emitted("open")).toHaveLength(1);
    expect(wrapper.find(".hay-home__note").text()).toContain("started on another device");
    expect(rows[1].attributes("aria-disabled")).toBe("true");
  });
});
