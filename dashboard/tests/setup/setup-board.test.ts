// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, stubNuxtGlobals } from "../component-harness";
import { board, row } from "./fixtures";

vi.mock("@/utils/api", () => ({ Hay: {}, HayApi: {} }));
vi.mock("@/middleware/auth.global", async () => ({
  hasRouteAccess: (await import("./fixtures")).hasRouteAccess,
}));
const chatAsk = vi.hoisted(() => vi.fn());
vi.mock("@/components/setup/SetupTestChat.vue", async () => {
  const { defineComponent: define, h: render } = await import("vue");
  return {
    default: define({
      name: "SetupTestChat",
      setup(_, { expose }) {
        expose({ ask: chatAsk });
        return () => render("div", { "data-stub": "SetupTestChat" });
      },
    }),
  };
});

vi.mock("@/components/setup/SetupReplay.vue", async () => {
  const { defineComponent: define, h: render } = await import("vue");
  return {
    default: define({
      name: "SetupReplay",
      setup: () => () => render("div", { "data-stub": "SetupReplay" }),
    }),
  };
});
const snippetState = vi.hoisted(() => ({ failed: false }));
vi.mock("@/composables/useWebchatSnippet", async () => {
  const { computed, ref } = await import("vue");
  return {
    useWebchatSnippet: () => ({
      snippet: computed(() => (snippetState.failed ? "" : "<script>install</script>")),
      loading: ref(false),
      failed: ref(snippetState.failed),
      enabled: ref(true),
      load: vi.fn(),
    }),
  };
});

import SetupRow from "../../components/setup/SetupRow.vue";
import SetupUpNext from "../../components/setup/SetupUpNext.vue";
import SetupBoardView from "../../components/setup/SetupBoard.vue";
import { useUserStore } from "@/stores/user";

const rowProps = {
  hasSite: true,
  expanded: false,
  saving: false,
  error: false,
  connectTo: null,
  playbookTo: null,
};

describe("SetupRow", () => {
  beforeEach(() => stubNuxtGlobals());

  const mountRow = (status: Parameters<typeof row>[0]["status"], extra = {}, props = {}) =>
    mountWithStubs(SetupRow, {
      props: {
        row: row({ id: "r1", status, ...extra }),
        displayStatus: status,
        ...rowProps,
        ...props,
      },
    });

  it("ready shows where the answer was found and offers Try it", async () => {
    const wrapper = mountRow("ready", { sources: [{ documentId: "d1", title: "Returns page" }] });
    expect(wrapper.text()).toContain("setup.status.ready");
    expect(wrapper.text()).toContain('setup.why.readyFound {"source":"Returns page"}');
    const tryIt = wrapper.findAll("button").find((b) => b.text() === "setup.action.tryIt");
    await tryIt!.trigger("click");
    expect(wrapper.emitted("try")).toHaveLength(1);
  });

  it("missing expands to a labelled textarea and saves the answer", async () => {
    const wrapper = mountRow("missing", {}, { expanded: true });
    expect(wrapper.text()).toContain("setup.status.missing");
    expect(wrapper.text()).toContain("setup.why.missingSite");
    const field = wrapper.get("textarea");
    expect(wrapper.get("label").attributes("for")).toBe(field.attributes("id"));
    await field.setValue("  Yes, we ship to Canada.  ");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("save")).toEqual([["Yes, we ship to Canada."]]);
  });

  it("missing says documents, not website, when there is no site", () => {
    const wrapper = mountRow("missing", {}, { hasSite: false });
    expect(wrapper.text()).toContain("setup.why.missingNoSite");
  });

  it("needs_connection links to the platform's connect page", () => {
    const wrapper = mountRow(
      "needs_connection",
      { needs: "orders", plugin: { id: "shopify", name: "Shopify" } },
      { connectTo: "/integrations/plugins/shopify?connect=1&return_to=x" },
    );
    expect(wrapper.text()).toContain("setup.status.needs_connection");
    expect(wrapper.get("a").attributes("href")).toBe(
      "/integrations/plugins/shopify?connect=1&return_to=x",
    );
  });

  it("needs_connection without a chosen platform asks to choose one", async () => {
    const wrapper = mountRow("needs_connection", { needs: "bookings" });
    expect(wrapper.find("a").exists()).toBe(false);
    const choose = wrapper
      .findAll("button")
      .find((b) => b.text() === "setup.action.choosePlatform");
    await choose!.trigger("click");
    expect(wrapper.emitted("choosePlatform")).toHaveLength(1);
  });

  it("playbook_off lists the playbook's steps inline", () => {
    const wrapper = mountRow(
      "playbook_off",
      { playbook: { id: "p1", title: "Order status", steps: ["Ask for the order", "Look it up"] } },
      { expanded: true, playbookTo: "/playbooks/p1" },
    );
    expect(wrapper.text()).toContain("setup.status.playbook_off");
    expect(wrapper.findAll("ol li").map((li) => li.text())).toEqual([
      "Ask for the order",
      "Look it up",
    ]);
    expect(wrapper.get("a").attributes("href")).toBe("/playbooks/p1");
  });

  it("check_failed says Couldn't check, never missing, and retries", async () => {
    const wrapper = mountRow("check_failed");
    expect(wrapper.text()).toContain("setup.status.check_failed");
    expect(wrapper.text()).not.toContain("setup.status.missing");
    const retry = wrapper.findAll("button").find((b) => b.text() === "setup.action.retry");
    await retry!.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("checking and reading_site have no action", () => {
    for (const status of ["checking", "reading_site"] as const) {
      const wrapper = mountRow(status);
      expect(wrapper.text()).toContain(`setup.status.${status}`);
      expect(wrapper.findAll("button")).toHaveLength(1); // only remove
    }
  });

  it("remove is labelled with the question", async () => {
    const wrapper = mountRow("ready");
    const remove = wrapper.get('button[aria-label^="setup.board.remove"]');
    expect(remove.attributes("aria-label")).toContain("Question r1");
    await remove.trigger("click");
    expect(wrapper.emitted("remove")).toHaveLength(1);
  });
});

describe("SetupUpNext", () => {
  beforeEach(() => stubNuxtGlobals());

  const mountNext = (upNext: unknown, props = {}) =>
    mountWithStubs(SetupUpNext, {
      props: { upNext, checking: false, total: 4, connectTo: null, canInstall: false, ...props },
    });

  it("connect names the platform and links to it", () => {
    const wrapper = mountNext(
      { kind: "connect", plugin: { id: "shopify", name: "Shopify" }, unlocks: 3 },
      { connectTo: "/integrations/plugins/shopify?connect=1" },
    );
    expect(wrapper.text()).toContain('setup.upNext.connect.title {"plugin":"Shopify"}');
    expect(wrapper.text()).toContain('setup.upNext.connect.whyOther {"count":3}');
    expect(wrapper.get("a").attributes("href")).toBe("/integrations/plugins/shopify?connect=1");
  });

  it("uses the singular copy for one unlocked request", () => {
    const wrapper = mountNext({ kind: "choose_platform", unlocks: 1 });
    expect(wrapper.text()).toContain('setup.upNext.choosePlatform.whyOne {"count":1}');
  });

  it("answer opens that row", async () => {
    const wrapper = mountNext({ kind: "answer", questionId: "q9", text: "Do you ship to Canada?" });
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("open")).toEqual([["q9"]]);
  });

  it("choose_platform emits choosePlatform", async () => {
    const wrapper = mountNext({ kind: "choose_platform", unlocks: 2 });
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("choosePlatform")).toHaveLength(1);
  });

  it("done opens the install panel when the role may use it", async () => {
    const wrapper = mountNext({ kind: "done" }, { canInstall: true });
    expect(wrapper.find("a").exists()).toBe(false);
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("install")).toHaveLength(1);
  });

  it("done offers nothing to a role that cannot install", () => {
    const wrapper = mountNext({ kind: "done" });
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("names no step while the first check is running", () => {
    const wrapper = mountNext(null, { checking: true, total: 5 });
    expect(wrapper.text()).toContain('setup.board.testingOther {"count":5}');
    expect(wrapper.find("button").exists()).toBe(false);
  });
});

describe("SetupBoard", () => {
  const actions = {
    addQuestion: vi.fn().mockResolvedValue(true),
    removeQuestion: vi.fn().mockResolvedValue(true),
    saveAnswer: vi.fn().mockResolvedValue(true),
    retryRow: vi.fn().mockResolvedValue(undefined),
    turnOnPlaybook: vi.fn().mockResolvedValue(true),
    generatePlaybook: vi.fn().mockResolvedValue(undefined),
    finishLater: vi.fn().mockResolvedValue(true),
  };

  const rows = [
    row({ id: "a", status: "ready", sources: [{ documentId: "d", title: "Shipping page" }] }),
    row({ id: "b", status: "missing" }),
    row({
      id: "c",
      status: "needs_connection",
      needs: "orders",
      plugin: { id: "shopify", name: "Shopify" },
    }),
  ];

  const mountBoard = (props: Record<string, unknown> = {}) =>
    mountWithStubs(SetupBoardView, {
      props: {
        board: board({
          rows,
          upNext: { kind: "connect", plugin: { id: "shopify", name: "Shopify" }, unlocks: 1 },
        }),
        checking: true,
        checkFailed: false,
        busyRowIds: [],
        actions,
        ...props,
      },
    });

  const statuses = (wrapper: ReturnType<typeof mountBoard>) =>
    wrapper.findAll("[data-row-id]").map((el) => el.attributes("data-status"));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setActivePinia(createPinia());
    stubNuxtGlobals();
    useUserStore().$patch({
      activeOrganizationId: "o1",
      organizations: [{ id: "o1", role: "admin" }] as never,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows every row as checking until results arrive, then settles once", async () => {
    const wrapper = mountBoard();
    expect(statuses(wrapper)).toEqual(["checking", "checking", "checking"]);
    expect(wrapper.text()).toContain("setup.board.testingOther");

    await wrapper.setProps({ checking: false });
    await vi.advanceTimersByTimeAsync(80);
    expect(statuses(wrapper)).toEqual(["ready", "checking", "checking"]);
    await vi.advanceTimersByTimeAsync(160);
    expect(statuses(wrapper)).toEqual(["ready", "missing", "needs_connection"]);
    expect(wrapper.text()).toContain('setup.board.ready {"ready":1,"total":3}');

    // A later check does not replay the reveal.
    await wrapper.setProps({ checking: true });
    expect(statuses(wrapper)).toEqual(["ready", "missing", "needs_connection"]);
  });

  it("skips the animation when the person prefers reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const wrapper = mountBoard();
    await wrapper.setProps({ checking: false });
    expect(statuses(wrapper)).toEqual(["ready", "missing", "needs_connection"]);
  });

  it("clears the reveal timer when unmounted mid-settle", async () => {
    const wrapper = mountBoard();
    await wrapper.setProps({ checking: false });
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("links Connect to the plugin page with an absolute return_to", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const wrapper = mountBoard({ checking: false });
    await flushPromises();
    const href = wrapper.findAll("a").map((a) => a.attributes("href"));
    const connect = href.filter((h) => h?.startsWith("/integrations/plugins/shopify"));
    expect(connect.length).toBeGreaterThan(0);
    const url = new URL(`http://x${connect[0]}`);
    expect(url.searchParams.get("connect")).toBe("1");
    expect(url.searchParams.get("return_to")).toBe(
      `${window.location.origin}/setup?plugin=shopify`,
    );
  });

  it("hides links the role cannot open", async () => {
    useUserStore().$patch({ organizations: [{ id: "o1", role: "contributor" }] as never });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const wrapper = mountBoard({ checking: false });
    await flushPromises();
    expect(wrapper.findAll("a").map((a) => a.attributes("href"))).toEqual([]);
  });

  it("Try it on a ready row asks the chat with that row's sources", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const wrapper = mountBoard({ checking: false });
    const tryIt = wrapper.findAll("button").find((b) => b.text() === "setup.action.tryIt");
    await tryIt!.trigger("click");
    expect(chatAsk).toHaveBeenCalledWith("Question a", [
      { documentId: "d", title: "Shipping page" },
    ]);
  });

  it("shows an empty state and a retry when the check failed", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const empty = mountBoard({ board: board({ rows: [] }), checking: false });
    expect(empty.text()).toContain("setup.board.emptyTitle");

    const failed = mountBoard({ checking: false, checkFailed: true });
    expect(failed.text()).toContain("setup.board.checkErrorTitle");
    await failed
      .findAll("button")
      .find((b) => b.text() === "setup.board.checkAgain")!
      .trigger("click");
    expect(failed.emitted("recheck")).toHaveLength(1);
  });

  it("adds a question and clears the field, keeps it on failure", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const wrapper = mountBoard({ checking: false });
    const input = wrapper.get<HTMLInputElement>(`input[aria-label="setup.board.addLabel"]`);
    await input.setValue("Do you gift wrap?");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(actions.addQuestion).toHaveBeenCalledWith("Do you gift wrap?");
    expect(input.element.value).toBe("");

    actions.addQuestion.mockResolvedValueOnce(false);
    await input.setValue("Another");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(input.element.value).toBe("Another");
    expect(wrapper.text()).toContain("setup.board.addError");
  });

  it("opens a row's answer form from the up-next action", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const wrapper = mountBoard({
      board: board({ rows, upNext: { kind: "answer", questionId: "b", text: "Question b" } }),
      checking: false,
    });
    const action = wrapper
      .get("[data-testid=setup-up-next]")
      .findAll("button")
      .find((b) => b.text() === "setup.upNext.answer.label");
    await action!.trigger("click");
    await flushPromises();
    expect(wrapper.find("textarea").exists()).toBe(true);
  });

  describe("add to your site", () => {
    const openPanel = async (wrapper: ReturnType<typeof mountBoard>) => {
      await wrapper
        .findAll("button")
        .find((b) => b.text() === "setup.board.addToSite")!
        .trigger("click");
      await flushPromises();
    };

    it("is available at any time and states how many requests are not ready", async () => {
      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      const wrapper = mountBoard({
        board: board({ rows, readyCount: 1, totalCount: 3 }),
        checking: false,
      });
      expect(wrapper.find("[data-testid=setup-install]").exists()).toBe(false);
      await openPanel(wrapper);
      expect(wrapper.get("[data-testid=install-honesty]").text()).toBe(
        'setup.install.notReadyOther {"count":2}',
      );
      expect(wrapper.get("[data-testid=install-code]").text()).toContain("install");
    });

    it("says everything is ready only when every request is", async () => {
      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      const wrapper = mountBoard({
        board: board({ rows, readyCount: 3, totalCount: 3, upNext: { kind: "done" } }),
        checking: false,
      });
      await openPanel(wrapper);
      expect(wrapper.get("[data-testid=install-honesty]").text()).toBe("setup.install.allReady");
    });

    it("copies the code", async () => {
      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const wrapper = mountBoard({ checking: false });
      await openPanel(wrapper);
      await wrapper
        .findAll("button")
        .find((b) => b.text() === "setup.install.copy")!
        .trigger("click");
      await flushPromises();
      expect(writeText).toHaveBeenCalledWith("<script>install</script>");
      expect(wrapper.text()).toContain("setup.install.copied");
      wrapper.unmount();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("opens from the done state of up next", async () => {
      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      const wrapper = mountBoard({
        board: board({ rows, readyCount: 3, totalCount: 3, upNext: { kind: "done" } }),
        checking: false,
      });
      await wrapper
        .get("[data-testid=setup-up-next]")
        .findAll("button")
        .find((b) => b.text() === "setup.upNext.done.label")!
        .trigger("click");
      await flushPromises();
      expect(wrapper.find("[data-testid=setup-install]").exists()).toBe(true);
    });

    it("is hidden from roles that cannot open the web chat settings", async () => {
      useUserStore().$patch({ organizations: [{ id: "o1", role: "contributor" }] as never });
      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      const wrapper = mountBoard({ checking: false });
      expect(wrapper.text()).not.toContain("setup.board.addToSite");
    });
  });

  describe("channels", () => {
    const channelBoard = (channelRefs: unknown[]) =>
      board({ rows, channelRefs: channelRefs as never });

    it("shows webchat as the install panel and plugin channels by connection state", async () => {
      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      const wrapper = mountBoard({
        board: channelBoard([
          { id: "webchat", name: "Website chat", connected: true },
          {
            id: "wa",
            name: "WhatsApp",
            plugin: { id: "whatsapp", name: "WhatsApp" },
            connected: true,
          },
          {
            id: "ig",
            name: "Instagram",
            plugin: { id: "instagram", name: "Instagram" },
            connected: false,
          },
        ]),
        checking: false,
      });
      const section = wrapper.get("[data-testid=setup-channels]");
      expect(section.text()).toContain("Website chat");
      expect(section.text()).toContain("setup.channels.connected");
      const link = section.get("a");
      const url = new URL(`http://x${link.attributes("href")}`);
      expect(url.pathname).toBe("/integrations/plugins/instagram");
      expect(url.searchParams.get("return_to")).toBe(
        `${window.location.origin}/setup?plugin=instagram`,
      );

      await section
        .findAll("button")
        .find((b) => b.text() === "setup.channels.addToSite")!
        .trigger("click");
      expect(wrapper.find("[data-testid=setup-install]").exists()).toBe(true);
    });

    it("shows nothing when no channel was picked", () => {
      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      const wrapper = mountBoard({ board: channelBoard([]), checking: false });
      expect(wrapper.find("[data-testid=setup-channels]").exists()).toBe(false);
    });
  });

  it("says so when only part of the site was read, and rewords missing", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const wrapper = mountBoard({
      board: board({
        rows: [row({ id: "b", status: "missing" })],
        site: { state: "done", discovered: 140, processed: 140, partial: true },
      }),
      checking: false,
    });
    expect(wrapper.get("[data-testid=setup-partial-notice]").text()).toContain(
      'setup.board.partialNoticeOther {"count":140}',
    );
    expect(wrapper.text()).toContain("setup.why.missingPartial");
    expect(wrapper.text()).not.toContain("setup.why.missingSite");
  });

  it("header plugin tags use the names the server sent", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const wrapper = mountBoard({
      board: board({
        rows,
        toolPluginIds: ["shopify"],
        toolPlugins: [{ id: "shopify", name: "Shopify" }],
      }),
      checking: false,
    });
    expect(wrapper.text()).toContain("Shopify");
  });

  it("Finish later calls the action", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const wrapper = mountBoard({ checking: false });
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "setup.board.finishLater")!
      .trigger("click");
    expect(actions.finishLater).toHaveBeenCalled();
  });
});
