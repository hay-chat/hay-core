// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createPersistedState } from "pinia-plugin-persistedstate";
import { board } from "./fixtures";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/utils/api", () => ({
  Hay: { setup: { get: { query: api.get } } },
  HayApi: {},
}));

import { useSetupStore } from "@/stores/setup";
import { useUserStore } from "@/stores/user";

/** A fresh page load: new Pinia, same localStorage. */
const reloadPage = () => {
  const pinia = createPinia();
  createApp({}).use(pinia);
  pinia.use(createPersistedState({ storage: window.localStorage, auto: false }));
  setActivePinia(pinia);
  useUserStore().$patch({
    activeOrganizationId: "o1",
    organizations: [{ id: "o1", role: "owner" }] as never,
  });
  return useSetupStore();
};

describe("saved setup board", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("is back after a reload, ready to show, and still refreshes from the server", async () => {
    const before = reloadPage();
    before.apply(board());
    await nextTick();

    const after = reloadPage();
    expect(after.status).toBe("ready");
    expect(after.board?.answeredAt).toBe(board().answeredAt);
    expect(after.organizationId).toBe("o1");

    api.get.mockResolvedValue(board({ website: "https://fresh.example" }));
    await after.load({ maxAgeMs: 60_000 });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(after.board?.website).toBe("https://fresh.example");
  });

  it("restores nothing after a reset", async () => {
    const store = reloadPage();
    store.apply(board());
    await nextTick();
    store.reset();
    await nextTick();

    const after = reloadPage();
    expect(after.board).toBeNull();
    expect(after.status).toBe("idle");
  });
});
