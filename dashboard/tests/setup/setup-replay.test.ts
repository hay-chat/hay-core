// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, stubNuxtGlobals } from "../component-harness";

const api = vi.hoisted(() => ({
  transcripts: vi.fn(),
  runs: vi.fn(),
  allowance: vi.fn(),
  report: vi.fn(),
  start: vi.fn(),
}));
vi.mock("@/utils/api", () => ({
  Hay: {
    testTranscripts: { list: { query: api.transcripts } },
    simulations: { list: { query: api.runs }, allowance: { query: api.allowance } },
    replays: { report: { query: api.report }, start: { mutate: api.start } },
  },
}));
vi.mock("@/middleware/auth.global", async () => ({
  hasRouteAccess: (await import("./fixtures")).hasRouteAccess,
}));
vi.mock("@/components/tests/TranscriptImportDialog.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "TranscriptImportDialog",
      props: { open: Boolean },
      setup: (props) => () => h("div", { "data-stub": "import", "data-open": String(props.open) }),
    }),
  };
});

import SetupReplay from "../../components/setup/SetupReplay.vue";
import { useUserStore } from "@/stores/user";

const bucket = (name: string, count: number) => ({ bucket: name, count, examples: [] });
const report = (over: Record<string, unknown> = {}) => ({
  run: { id: "run-1", status: "completed", kind: "replay" },
  sampleSize: 20,
  inProgress: 0,
  notJudged: 0,
  buckets: [
    bucket("answered", 12),
    bucket("handed_off", 5),
    bucket("needed_action", 0),
    bucket("wrong_or_risky", 1),
    bucket("knowledge_missing", 2),
  ],
  agreement: { same: 0, partial: 0, different: 0 },
  ...over,
});

const mountReplay = async () => {
  const wrapper = mountWithStubs(SetupReplay);
  await flushPromises();
  return wrapper;
};
const button = (wrapper: Awaited<ReturnType<typeof mountReplay>>, text: string) =>
  wrapper.findAll("button").find((b) => b.text() === text);

describe("SetupReplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setActivePinia(createPinia());
    stubNuxtGlobals();
    useUserStore().$patch({
      activeOrganizationId: "o1",
      organizations: [{ id: "o1", role: "admin" }] as never,
    });
    api.transcripts.mockResolvedValue({ items: [], total: 0 });
    api.runs.mockResolvedValue([]);
    api.allowance.mockResolvedValue({ limit: 200, used: 50, remaining: 150 });
  });
  afterEach(() => vi.useRealTimers());

  it("starts with an import and stays quiet about cost until something is imported", async () => {
    const wrapper = await mountReplay();
    expect(button(wrapper, "setup.replay.import")).toBeDefined();
    expect(button(wrapper, 'setup.replay.runOther {"count":0}')).toBeUndefined();
    expect(wrapper.find("[data-testid=replay-cost]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=replay-counts]").exists()).toBe(false);
  });

  it("says what a replay costs once there is something to replay, on a quiet button", async () => {
    api.transcripts.mockResolvedValue({ items: [{ id: "t1" }], total: 1 });
    const wrapper = await mountReplay();
    expect(wrapper.get("[data-testid=replay-cost]").text()).toBe(
      'setup.replay.cost {"remaining":150,"limit":200}',
    );
    expect(button(wrapper, 'setup.replay.runOne {"count":1}')!.attributes("variant")).toBe(
      "outline",
    );
  });

  it("opens the existing import dialog", async () => {
    const wrapper = await mountReplay();
    await button(wrapper, "setup.replay.import")!.trigger("click");
    expect(wrapper.get("[data-stub=import]").attributes("data-open")).toBe("true");
  });

  it("offers a replay of what was imported, capped at a small sample", async () => {
    api.transcripts.mockResolvedValue({ items: [{ id: "t1" }, { id: "t2" }], total: 60 });
    api.start.mockResolvedValue({ id: "run-9" });
    api.report.mockResolvedValue(
      report({ run: { id: "run-9", status: "running" }, inProgress: 4, sampleSize: 2 }),
    );
    const wrapper = await mountReplay();
    await button(wrapper, 'setup.replay.runOther {"count":20}')!.trigger("click");
    await flushPromises();
    expect(api.start).toHaveBeenCalledWith({
      transcriptIds: ["t1", "t2"],
      maxTurnsPerConversation: 3,
    });
    expect(wrapper.text()).toContain('setup.replay.running {"done":2,"total":6}');
  });

  it("shows the real report counts, with no percentages, and links to the full report", async () => {
    api.transcripts.mockResolvedValue({ items: [{ id: "t1" }], total: 1 });
    api.runs.mockResolvedValue([
      { id: "other", kind: "manual" },
      { id: "run-1", kind: "replay" },
    ]);
    api.report.mockResolvedValue(report());
    const wrapper = await mountReplay();
    expect(api.report).toHaveBeenCalledWith({ runId: "run-1" });
    const counts = wrapper.get("[data-testid=replay-counts]").text();
    expect(counts).toContain("setup.replay.buckets.answered12");
    expect(counts).toContain("setup.replay.buckets.handed_off5");
    expect(counts).toContain("setup.replay.buckets.knowledge_missing2");
    // Buckets with nothing in them stay out of the way; ones with something show.
    expect(counts).toContain("setup.replay.buckets.wrong_or_risky1");
    expect(counts).not.toContain("needed_action");
    expect(wrapper.text()).not.toContain("%");
    expect(wrapper.get("a").attributes("href")).toBe("/tests/run-1");
  });

  it("polls a running replay and stops when it finishes or unmounts", async () => {
    api.runs.mockResolvedValue([{ id: "run-1", kind: "replay" }]);
    api.report
      .mockResolvedValueOnce(report({ run: { id: "run-1", status: "running" }, inProgress: 3 }))
      .mockResolvedValue(report());
    const wrapper = await mountReplay();
    expect(wrapper.text()).toContain("setup.replay.running");
    await vi.advanceTimersByTimeAsync(4000);
    expect(wrapper.text()).not.toContain("setup.replay.running");
    expect(vi.getTimerCount()).toBe(0);

    api.report.mockResolvedValue(
      report({ run: { id: "run-1", status: "running" }, inProgress: 3 }),
    );
    await vi.advanceTimersByTimeAsync(0);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("says when a run stopped at its usage limit", async () => {
    api.runs.mockResolvedValue([{ id: "run-1", kind: "replay" }]);
    api.report.mockResolvedValue(report({ run: { id: "run-1", status: "capped" } }));
    const wrapper = await mountReplay();
    expect(wrapper.text()).toContain("setup.replay.capped");
  });

  it("says so when the monthly allowance is used up and blocks the replay", async () => {
    api.transcripts.mockResolvedValue({ items: [{ id: "t1" }], total: 1 });
    api.allowance.mockResolvedValue({ limit: 200, used: 200, remaining: 0 });
    const wrapper = await mountReplay();
    expect(wrapper.text()).toContain("setup.replay.allowanceUsed");
    expect(
      button(wrapper, 'setup.replay.runOne {"count":1}')!.attributes("disabled"),
    ).toBeDefined();
  });

  it("reports a refused start from the server as the allowance", async () => {
    const { TRPCClientError } = await import("@trpc/client");
    api.transcripts.mockResolvedValue({ items: [{ id: "t1" }], total: 1 });
    api.start.mockRejectedValue(
      Object.assign(Object.create(TRPCClientError.prototype), { data: { code: "FORBIDDEN" } }),
    );
    const wrapper = await mountReplay();
    await button(wrapper, 'setup.replay.runOne {"count":1}')!.trigger("click");
    await flushPromises();
    expect(wrapper.get("[role=alert]").text()).toBe("setup.replay.allowanceUsed");
  });

  it("never blocks setup: a load failure is an inline retry", async () => {
    api.transcripts.mockRejectedValueOnce(new Error("offline"));
    const wrapper = await mountReplay();
    expect(wrapper.get("[role=alert]").text()).toContain("setup.replay.loadError");
    await button(wrapper, "setup.replay.retry")!.trigger("click");
    await flushPromises();
    expect(wrapper.find("[role=alert]").exists()).toBe(false);
  });
});
