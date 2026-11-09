// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, stubNuxtGlobals } from "../component-harness";
import { board, row } from "./fixtures";

const api = vi.hoisted(() => ({ get: vi.fn(), checkQuestions: vi.fn() }));
vi.mock("@/composables/useDomain", () => ({
  useDomain: () => ({ getApiUrl: (path: string) => `http://api${path}` }),
}));
vi.mock("@/composables/useToolLabel", () => ({
  useToolLabel: () => ({ getToolLabel: (_plugin: string, tool: string) => `Label of ${tool}` }),
}));
vi.mock("@/utils/api", () => ({
  Hay: {
    setup: { get: { query: api.get }, checkQuestions: { mutate: api.checkQuestions } },
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
import SetupRow from "../../components/setup/SetupRow.vue";
import { useUserStore } from "@/stores/user";

describe("a missing row that handed off", () => {
  beforeEach(() => stubNuxtGlobals());

  it("says the assistant was not sure enough, never that the site doesn't say, and offers Add answer", () => {
    const wrapper = mountWithStubs(SetupRow, {
      props: {
        row: row({ id: "r1", status: "missing", handedOff: true }),
        displayStatus: "missing",
        hasSite: true,
        expanded: false,
        saving: false,
        error: false,
        connectTo: null,
        playbookTo: null,
      },
    });
    expect(wrapper.text()).toContain("setup.why.missingHandedOff");
    expect(wrapper.text()).not.toContain("setup.why.missingSite");
    expect(wrapper.text()).toContain("setup.action.addAnswer");
  });
});

describe("rows still being tested for real", () => {
  const testing = board({
    rows: [row({ id: "a", status: "checking" }), row({ id: "b", status: "ready" })],
  });
  const settled = board({
    rows: [row({ id: "a", status: "ready" }), row({ id: "b", status: "ready" })],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setActivePinia(createPinia());
    stubNuxtGlobals();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("useToast", () => ({ success: vi.fn(), error: vi.fn() }));
    useUserStore().$patch({
      activeOrganizationId: "o1",
      organizationId: "o1",
      organizations: [{ id: "o1", role: "owner" }] as never,
    });
    api.get.mockResolvedValue(testing);
    api.checkQuestions.mockResolvedValue(testing);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the testing band up, polls the board, and stops once every turn finished", async () => {
    const wrapper = mountWithStubs(SetupPage);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.text()).toContain('setup.board.testingOne {"count":1}');
    const readsBefore = api.get.mock.calls.length;

    await vi.advanceTimersByTimeAsync(3100);
    expect(api.get.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(wrapper.text()).toContain("setup.board.testing");

    api.get.mockResolvedValue(settled);
    await vi.advanceTimersByTimeAsync(3100);
    await flushPromises();
    expect(wrapper.text()).not.toContain("setup.board.testing");
    const reads = api.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.get.mock.calls.length).toBe(reads);
  });
});
