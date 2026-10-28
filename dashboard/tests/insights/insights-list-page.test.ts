// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, router, stubNuxtGlobals } from "../component-harness";

const api = vi.hoisted(() => ({ list: vi.fn() }));
const user = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("@/utils/api", () => ({ HayApi: { insights: { list: { query: api.list } } } }));
vi.mock("@/stores/user", () => ({ useUserStore: () => user }));

import InsightsPage from "../../pages/insights/index.vue";

const counts = { open: 3, new: 1, positive: 1, addressed: 2, fixed: 1, measured: 2 };
const item = (overrides: Record<string, unknown> = {}) => ({
  id: "i-1",
  title: "Late deliveries",
  summary: "Shoppers ask where their order is",
  polarity: "negative",
  state: "new",
  actionType: "playbook_edit",
  origin: "conversations",
  recurredAt: null,
  fixed: null,
  archiveSuggested: false,
  periodSize: 12,
  lastSeenAt: "2026-10-20",
  ...overrides,
});
const listResult = (items: unknown[]) => ({
  items,
  counts,
  minClusterSize: 5,
  backfill: { running: false },
});

// The settings dialog has its own tests; keep this page test to the list.
const mountPage = () => mountWithStubs(InsightsPage, { stubs: { InsightsSettingsDialog: true } });

describe("Insights list page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubNuxtGlobals();
    user.isAdmin = true;
  });

  it("loads open insights from the last 30 days and shows counts and badges", async () => {
    api.list.mockResolvedValue(
      listResult([
        item(),
        item({ id: "i-2", title: null, archiveSuggested: true, origin: "docs_audit" }),
      ]),
    );
    const wrapper = mountPage();
    await flushPromises();

    expect(api.list).toHaveBeenCalledWith({
      polarity: undefined,
      state: "open",
      actionType: undefined,
      days: 30,
      minSize: undefined,
    });
    const text = wrapper.text();
    expect(text).toContain('insights.page.counts.fixedRateValue {"fixed":1,"measured":2}');
    expect(text).toContain("Late deliveries");
    expect(text).toContain("insights.page.list.untitled");
    expect(text).toContain("insights.page.list.archiveSuggested");
    expect(text).toContain("insights.page.list.docsAudit");
    expect(text).toContain('insights.page.list.count {"count":2}');
  });

  it("reloads with the chosen filters", async () => {
    api.list.mockResolvedValue(listResult([]));
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('select[aria-label="insights.page.filters.window"]').setValue("90");
    await wrapper.get('select[aria-label="insights.page.filters.minSize"]').setValue("10");
    await flushPromises();

    expect(api.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ days: 90, minSize: 10, state: "open" }),
    );
  });

  it("shows the empty state with the minimum size, and opens an insight on click", async () => {
    api.list.mockResolvedValueOnce(listResult([]));
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.get('[data-stub="EmptyState"]').text()).toContain('{"min":5}');

    api.list.mockResolvedValueOnce(listResult([item()]));
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();
    await wrapper.get('[role="link"]').trigger("click");
    expect(router.push).toHaveBeenCalledWith("/insights/i-1");
  });

  it("shows Settings to admins only", async () => {
    api.list.mockResolvedValue(listResult([]));
    const buttons = async () => {
      const wrapper = mountPage();
      await flushPromises();
      return wrapper.findAll("button").map((b) => b.text());
    };
    expect(await buttons()).toContain("insights.page.settings");
    user.isAdmin = false;
    expect(await buttons()).not.toContain("insights.page.settings");
  });
});
