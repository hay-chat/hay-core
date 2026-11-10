// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { mountWithStubs, router, stubNuxtGlobals } from "../component-harness";
import { board, row } from "./fixtures";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  checkQuestions: vi.fn(),
  dismiss: vi.fn(),
  updateQuestion: vi.fn(),
}));
vi.mock("@/composables/useDomain", () => ({
  useDomain: () => ({ getApiUrl: (path: string) => `http://api${path}` }),
}));
vi.mock("@/composables/useToolLabel", () => ({
  useToolLabel: () => ({ getToolLabel: (_plugin: string, tool: string) => `Label of ${tool}` }),
}));
vi.mock("@/utils/api", () => ({
  Hay: {
    setup: {
      get: { query: api.get },
      checkQuestions: { mutate: api.checkQuestions },
      dismiss: { mutate: api.dismiss },
      updateQuestion: { mutate: api.updateQuestion },
    },
  },
  HayApi: {},
}));
vi.mock("@/utils/route-access", async () => ({
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

import SetupPage from "../../pages/setup/index.vue";
import { useSetupStore } from "@/stores/setup";
import { useUserStore } from "@/stores/user";

const rows = [row({ id: "a", status: "ready" }), row({ id: "b", status: "missing" })];

describe("setup page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setActivePinia(createPinia());
    stubNuxtGlobals();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("useToast", () => ({ success: vi.fn(), error: vi.fn() }));
    useUserStore().$patch({
      activeOrganizationId: "o1",
      organizations: [{ id: "o1", role: "owner" }] as never,
    });
    api.get.mockResolvedValue(board({ rows }));
    api.checkQuestions.mockResolvedValue(board({ rows }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("checks the rows once on arrival and shows their real status", async () => {
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    expect(api.checkQuestions).toHaveBeenCalledTimes(1);
    expect(api.checkQuestions).toHaveBeenCalledWith({});
    expect(wrapper.findAll("[data-row-id]").map((r) => r.attributes("data-status"))).toEqual([
      "missing",
      "ready",
    ]);
  });

  it("starts with the questions when nothing has been answered", async () => {
    api.get.mockResolvedValue(board({ rows: [], answeredAt: undefined, businessType: undefined }));
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    expect(api.checkQuestions).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("setup.questions.type.title");
  });

  describe("while the server has not answered yet", () => {
    let answer: (value: unknown) => void;
    const QUESTIONS = "setup.questions.type.title";
    const SKELETON = ".animate-pulse";

    beforeEach(() => {
      api.get.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    });

    it("never shows the questions when the sidebar already loaded a started board", async () => {
      useSetupStore().apply(board({ rows }));
      const wrapper = mountWithStubs(SetupPage);
      await nextTick();
      expect(wrapper.text()).not.toContain(QUESTIONS);
      // The board opens straight away, with rows checking rather than showing old statuses.
      expect(wrapper.findAll("[data-row-id]").map((r) => r.attributes("data-status"))).toEqual([
        "checking",
        "checking",
      ]);
      answer(board({ rows }));
      await flushPromises();
      expect(wrapper.text()).not.toContain(QUESTIONS);
      expect(api.checkQuestions).toHaveBeenCalledTimes(1);
    });

    it("shows a skeleton, not the questions, when it holds a board without answers", async () => {
      useSetupStore().apply(board({ rows: [], answeredAt: undefined }));
      const wrapper = mountWithStubs(SetupPage);
      await nextTick();
      expect(wrapper.find(SKELETON).exists()).toBe(true);
      expect(wrapper.text()).not.toContain(QUESTIONS);

      // Answered on another device: the server's word wins, no flash of the questions.
      answer(board({ rows }));
      await flushPromises();
      expect(wrapper.find(SKELETON).exists()).toBe(false);
      expect(wrapper.text()).not.toContain(QUESTIONS);
      expect(wrapper.findAll("[data-row-id]")).toHaveLength(2);
    });

    it("shows a skeleton on a first visit, then the questions once the server says so", async () => {
      const wrapper = mountWithStubs(SetupPage);
      await nextTick();
      expect(wrapper.find(SKELETON).exists()).toBe(true);
      expect(wrapper.text()).not.toContain(QUESTIONS);

      answer(board({ rows: [], answeredAt: undefined, businessType: undefined }));
      await flushPromises();
      expect(wrapper.find(SKELETON).exists()).toBe(false);
      expect(wrapper.text()).toContain(QUESTIONS);
    });

    it("does not open a board held for another organization", async () => {
      const store = useSetupStore();
      store.apply(board({ rows }));
      store.organizationId = "other-org";
      const wrapper = mountWithStubs(SetupPage);
      await nextTick();
      expect(wrapper.findAll("[data-row-id]")).toHaveLength(0);
      expect(wrapper.find(SKELETON).exists()).toBe(true);
      answer(board({ rows }));
      await flushPromises();
    });
  });

  it("polls while the site is being read, checks once when it is done, then stops", async () => {
    const reading = board({
      rows: [row({ id: "a", status: "reading_site" })],
      site: { state: "reading", discovered: 30, processed: 5 },
    });
    api.get.mockResolvedValue(reading);
    api.checkQuestions.mockResolvedValue(reading);
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.checkQuestions).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(api.get).toHaveBeenCalledTimes(2);

    const done = board({
      rows: [row({ id: "a", status: "ready" })],
      site: { state: "done", discovered: 30, processed: 30 },
    });
    api.get.mockResolvedValue(done);
    api.checkQuestions.mockResolvedValue(done);
    await vi.advanceTimersByTimeAsync(3000);
    await flushPromises();
    expect(api.checkQuestions).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.get).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });

  it("clears the poll timer on unmount", async () => {
    api.get.mockResolvedValue(
      board({ rows, site: { state: "reading", discovered: 10, processed: 1 } }),
    );
    api.checkQuestions.mockResolvedValue(
      board({ rows, site: { state: "reading", discovered: 10, processed: 1 } }),
    );
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("shows an error with a working retry", async () => {
    api.get.mockRejectedValueOnce(new Error("offline"));
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    expect(wrapper.text()).toContain("setup.state.errorTitle");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "setup.state.retry")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("setup.state.errorTitle");
    expect(wrapper.findAll("[data-row-id]")).toHaveLength(2);
  });

  it("tells roles without access instead of failing", async () => {
    useUserStore().$patch({ organizations: [{ id: "o1", role: "member" }] as never });
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    expect(api.get).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("setup.state.forbiddenTitle");
  });

  it("Finish later dismisses setup, then goes home", async () => {
    api.dismiss.mockResolvedValue(board({ rows, dismissedAt: "2026-11-05T12:00:00.000Z" }));
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "setup.board.finishLater")!
      .trigger("click");
    await flushPromises();
    expect(api.dismiss).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/");
  });

  it("stays put and says so when dismissing fails", async () => {
    api.dismiss.mockRejectedValue(new Error("offline"));
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "setup.board.finishLater")!
      .trigger("click");
    await flushPromises();
    expect(router.push).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("setup.board.finishError");
  });

  it("saves an answer for a missing row through the server and shows the rechecked board", async () => {
    api.updateQuestion.mockResolvedValue(
      board({ rows: [row({ id: "a", status: "ready" }), row({ id: "b", status: "ready" })] }),
    );
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "setup.action.addAnswer")!
      .trigger("click");
    await wrapper.get("textarea").setValue("Yes, we ship to Canada.");
    await wrapper.get("[data-testid=setup-panel]").trigger("submit");
    await flushPromises();
    expect(api.updateQuestion).toHaveBeenCalledWith({
      questionId: "b",
      answer: "Yes, we ship to Canada.",
    });
    expect(wrapper.find("[data-testid=setup-panel]").exists()).toBe(false);
    expect(wrapper.findAll("[data-row-id]").map((r) => r.attributes("data-status"))).toEqual([
      "ready",
      "ready",
    ]);
  });
});
