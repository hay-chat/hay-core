// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, route, router, stubNuxtGlobals, toast } from "../component-harness";
import { board, row } from "./fixtures";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  checkQuestions: vi.fn(),
  generatePlaybooks: vi.fn(),
  turnOnPlaybook: vi.fn(),
}));
vi.mock("@/composables/useDomain", () => ({
  useDomain: () => ({ getApiUrl: (path: string) => `http://api${path}` }),
}));
vi.mock("@/utils/api", () => ({
  Hay: {
    setup: {
      get: { query: api.get },
      checkQuestions: { mutate: api.checkQuestions },
      generatePlaybooks: { mutate: api.generatePlaybooks },
      turnOnPlaybook: { mutate: api.turnOnPlaybook },
    },
  },
  HayApi: {},
}));
vi.mock("@/middleware/auth.global", async () => ({
  hasRouteAccess: (await import("./fixtures")).hasRouteAccess,
}));
vi.mock("@/components/setup/SetupTestChat.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "SetupTestChat",
      setup: (_, { expose }) => {
        expose({ ask: vi.fn() });
        return () => h("div");
      },
    }),
  };
});
vi.mock("@/components/setup/SetupReplay.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ name: "SetupReplay", setup: () => () => h("div") }) };
});
vi.mock("@/composables/useWebchatSnippet", async () => {
  const { computed, ref } = await import("vue");
  return {
    useWebchatSnippet: () => ({
      snippet: computed(() => ""),
      loading: ref(false),
      failed: ref(false),
      enabled: ref(true),
      load: vi.fn(),
    }),
  };
});

import SetupRow from "../../components/setup/SetupRow.vue";
import SetupUpNext from "../../components/setup/SetupUpNext.vue";
import SetupBoardView from "../../components/setup/SetupBoard.vue";
import SetupPage from "../../pages/setup/index.vue";
import { describeUpNext } from "../../composables/useSetupCopy";
import { translate } from "../component-harness";
import { useUserStore } from "@/stores/user";

const shop = { id: "shopify", name: "Shopify" };
const draft = {
  id: "pb1",
  title: "Order status",
  steps: ["Ask for the order number", "Look the order up", "Tell the customer"],
};

describe("inline playbook review", () => {
  beforeEach(() => stubNuxtGlobals());

  const mountRow = (status: string, extra = {}, props = {}) =>
    mountWithStubs(SetupRow, {
      props: {
        row: row({ id: "r1", status: status as never, needs: "orders", plugin: shop, ...extra }),
        displayStatus: status,
        hasSite: true,
        expanded: true,
        saving: false,
        error: false,
        connectTo: null,
        playbookTo: "/playbooks/pb1",
        ...props,
      },
    });

  it("shows the steps with Turn on and Not now, and turning on emits once", async () => {
    const wrapper = mountRow("playbook_off", { playbook: draft });
    expect(wrapper.get("[data-testid=setup-playbook-review]").exists()).toBe(true);
    expect(wrapper.findAll("ol li").map((li) => li.text())).toEqual(draft.steps);
    expect(wrapper.text()).toContain("setup.playbook.reviewHint");

    const labels = wrapper.findAll("button").map((b) => b.text());
    expect(labels).toContain("setup.playbook.turnOn");
    expect(labels).toContain("setup.playbook.close");

    await wrapper
      .findAll("button")
      .find((b) => b.text() === "setup.playbook.turnOn")!
      .trigger("click");
    expect(wrapper.emitted("turnOn")).toHaveLength(1);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "setup.playbook.close")!
      .trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });

  it("disables Turn on while it is running and shows an error when it failed", () => {
    const busy = mountRow("playbook_off", { playbook: draft }, { turningOn: true });
    const turnOn = busy.findAll("button").find((b) => b.text() === "setup.playbook.turnOn")!;
    expect(turnOn.attributes("disabled")).toBeDefined();

    const failed = mountRow("playbook_off", { playbook: draft }, { turnOnError: true });
    expect(failed.get("[role=alert]").text()).toBe("setup.playbook.turnOnError");
  });

  it("stays closed until expanded", () => {
    const wrapper = mountRow("playbook_off", { playbook: draft }, { expanded: false });
    expect(wrapper.find("[data-testid=setup-playbook-review]").exists()).toBe(false);
    expect(wrapper.text()).toContain("setup.action.review");
  });

  it("a request with no playbook says why and offers to write one or try again", async () => {
    const noTool = mountRow(
      "playbook_missing",
      { generation: "no_tool" },
      { writeTo: "/playbooks/new?redirect=/setup", expanded: false },
    );
    expect(noTool.text()).toContain('setup.why.playbookNoTool {"plugin":"Shopify"}');
    expect(noTool.get("a").attributes("href")).toBe("/playbooks/new?redirect=/setup");
    await noTool
      .findAll("button")
      .find((b) => b.text() === "setup.action.retry")!
      .trigger("click");
    expect(noTool.emitted("regenerate")).toHaveLength(1);

    const failed = mountRow("playbook_missing", { generation: "failed" }, { expanded: false });
    expect(failed.text()).toContain("setup.why.playbookFailed");
    const pending = mountRow(
      "playbook_missing",
      { generation: "pending" },
      { writeTo: "/playbooks/new?redirect=/setup", expanded: false },
    );
    expect(pending.text()).toContain("setup.why.playbookWriting");
    expect(pending.find("a").exists()).toBe(false);
  });

  it("shows a connect error only on the row it belongs to", () => {
    const wrapper = mountRow(
      "needs_connection",
      {},
      { expanded: false, connectFailure: { detail: "access_denied" } },
    );
    expect(wrapper.get("[data-testid=setup-connect-error]").text()).toContain("access_denied");
    const quiet = mountRow("needs_connection", {}, { expanded: false });
    expect(quiet.find("[data-testid=setup-connect-error]").exists()).toBe(false);
  });
});

describe("up next with capability", () => {
  beforeEach(() => stubNuxtGlobals());

  it("names what the platform unlocks, and falls back without a capability", () => {
    const t = (key: string, params?: Record<string, unknown>) => translate(key, params);
    const withCapability = describeUpNext(t, {
      kind: "connect",
      plugin: shop,
      unlocks: 3,
      capability: "orders",
    });
    expect(withCapability.why).toBe(
      'setup.upNext.connect.whyCapabilityOther {"count":3,"capability":"setup.needs.orders"}',
    );
    expect(
      describeUpNext(t, { kind: "choose_platform", unlocks: 1, capability: "refunds" }).why,
    ).toContain("whyCapabilityOne");
    expect(describeUpNext(t, { kind: "connect", plugin: shop, unlocks: 2 }).why).toBe(
      'setup.upNext.connect.whyOther {"count":2}',
    );
  });

  it("write_playbook links to the editor", () => {
    const wrapper = mountWithStubs(SetupUpNext, {
      props: {
        upNext: { kind: "write_playbook", questionId: "q1", text: "Where is my order?" },
        checking: false,
        total: 3,
        connectTo: null,
        doneTo: null,
        writeTo: "/playbooks/new?redirect=/setup",
      },
    });
    expect(wrapper.get("a").attributes("href")).toBe("/playbooks/new?redirect=/setup");
  });
});

describe("board turn on", () => {
  const actions = {
    addQuestion: vi.fn().mockResolvedValue(true),
    removeQuestion: vi.fn().mockResolvedValue(true),
    saveAnswer: vi.fn().mockResolvedValue(true),
    retryRow: vi.fn().mockResolvedValue(undefined),
    turnOnPlaybook: vi.fn(),
    generatePlaybook: vi.fn().mockResolvedValue(undefined),
    finishLater: vi.fn().mockResolvedValue(true),
  };
  const rows = [
    row({ id: "o", status: "playbook_off", needs: "orders", plugin: shop, playbook: draft }),
    row({ id: "x", status: "needs_connection", needs: "refunds", plugin: shop }),
  ];
  const mountBoard = (props: Record<string, unknown> = {}) =>
    mountWithStubs(SetupBoardView, {
      props: {
        board: board({
          rows,
          upNext: { kind: "playbook", questionId: "o", title: "Order status" },
        }),
        checking: false,
        checkFailed: false,
        busyRowIds: [],
        actions,
        ...props,
      },
    });

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    stubNuxtGlobals();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    useUserStore().$patch({
      activeOrganizationId: "o1",
      organizations: [{ id: "o1", role: "admin" }] as never,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const openReview = async (wrapper: ReturnType<typeof mountBoard>) => {
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "setup.action.review")!
      .trigger("click");
  };

  it("review opens inline; Turn on calls the action and closes the row", async () => {
    actions.turnOnPlaybook.mockResolvedValue(true);
    const wrapper = mountBoard();
    await openReview(wrapper);
    expect(wrapper.findAll("[data-testid=setup-playbook-review] li")).toHaveLength(3);

    await wrapper
      .findAll("button")
      .find((b) => b.text() === "setup.playbook.turnOn")!
      .trigger("click");
    await flushPromises();
    expect(actions.turnOnPlaybook).toHaveBeenCalledWith("o");
    expect(wrapper.find("[data-testid=setup-playbook-review]").exists()).toBe(false);
  });

  it("a failed Turn on keeps the review open with an error", async () => {
    actions.turnOnPlaybook.mockResolvedValue(false);
    const wrapper = mountBoard();
    await openReview(wrapper);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "setup.playbook.turnOn")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("setup.playbook.turnOnError");
    expect(wrapper.find("[data-testid=setup-playbook-review]").exists()).toBe(true);
  });

  it("the connect error lands on the failed platform's rows only", () => {
    const wrapper = mountBoard({ connectError: { pluginId: "shopify", detail: "denied" } });
    const errors = wrapper.findAll("[data-testid=setup-connect-error]");
    expect(errors).toHaveLength(1);
    expect(wrapper.get("[data-row-id=x]").find("[data-testid=setup-connect-error]").exists()).toBe(
      true,
    );
    const other = mountBoard({ connectError: { pluginId: "stripe" } });
    expect(other.findAll("[data-testid=setup-connect-error]")).toHaveLength(0);
  });
});

describe("setup page: platforms", () => {
  const pending = row({
    id: "o",
    status: "playbook_missing",
    needs: "orders",
    plugin: shop,
    generation: "pending",
  });
  const drafted = row({
    id: "o",
    status: "playbook_off",
    needs: "orders",
    plugin: shop,
    playbook: draft,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setActivePinia(createPinia());
    stubNuxtGlobals();
    route.query = {};
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    useUserStore().$patch({
      activeOrganizationId: "o1",
      organizations: [{ id: "o1", role: "owner" }] as never,
    });
    api.get.mockResolvedValue(board({ rows: [pending] }));
    api.checkQuestions.mockResolvedValue(board({ rows: [pending] }));
    api.generatePlaybooks.mockResolvedValue(board({ rows: [drafted] }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("drafts playbooks once for connected rows that have none, then shows the draft", async () => {
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    expect(api.generatePlaybooks).toHaveBeenCalledTimes(1);
    expect(api.generatePlaybooks).toHaveBeenCalledWith({});
    expect(wrapper.get("[data-row-id=o]").attributes("data-status")).toBe("playbook_off");
  });

  it("does not generate when nothing is pending", async () => {
    api.get.mockResolvedValue(board({ rows: [drafted] }));
    api.checkQuestions.mockResolvedValue(board({ rows: [drafted] }));
    mountWithStubs(SetupPage);
    await flushPromises();
    expect(api.generatePlaybooks).not.toHaveBeenCalled();
  });

  it("a failed generation tells the person and leaves the row retryable", async () => {
    api.generatePlaybooks.mockRejectedValue(new Error("offline"));
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    expect(toast.error).toHaveBeenCalled();
    expect(wrapper.get("[data-row-id=o]").attributes("data-status")).toBe("playbook_missing");
  });

  it("coming back from a connect refreshes the board, then drafts playbooks", async () => {
    route.query = { hay_connect: "success", plugin: "shopify" };
    const before = row({ id: "o", status: "needs_connection", needs: "orders", plugin: shop });
    api.get.mockResolvedValueOnce(board({ rows: [before] }));
    api.get.mockResolvedValue(board({ rows: [pending] }));
    api.checkQuestions.mockResolvedValue(board({ rows: [before] }));

    mountWithStubs(SetupPage);
    await flushPromises();
    expect(router.replace).toHaveBeenCalledWith({ path: "/setup" });
    // The platform was not connected yet on the first read: wait, read again.
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.generatePlaybooks).toHaveBeenCalled();
  });

  it("stops waiting for a connection that never shows up", async () => {
    route.query = { hay_connect: "success", plugin: "shopify" };
    const before = row({ id: "o", status: "needs_connection", needs: "orders", plugin: shop });
    api.get.mockResolvedValue(board({ rows: [before] }));
    api.checkQuestions.mockResolvedValue(board({ rows: [before] }));
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10_000);
    await flushPromises();
    expect(api.get).toHaveBeenCalledTimes(4); // first read + three retries
    expect(api.generatePlaybooks).not.toHaveBeenCalled();
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an error return shows next to the platform's row", async () => {
    route.query = { hay_connect: "error", hay_connect_error: "access_denied", plugin: "shopify" };
    const before = row({ id: "o", status: "needs_connection", needs: "orders", plugin: shop });
    api.get.mockResolvedValue(board({ rows: [before] }));
    api.checkQuestions.mockResolvedValue(board({ rows: [before] }));
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(80 * 3);
    await flushPromises();
    expect(router.replace).toHaveBeenCalledWith({ path: "/setup" });
    expect(wrapper.get("[data-testid=setup-connect-error]").text()).toContain("access_denied");
  });
});
