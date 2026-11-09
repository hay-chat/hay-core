import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, type EffectScope } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { useCachedQuery } from "@/composables/useCachedQuery";
import { useUserStore } from "@/stores/user";
import {
  MAX_AGE_MS,
  clearQueryCache,
  invalidateForMutation,
  invalidateQueries,
} from "@/utils/query-cache";

type Rows = string[];

/** A fetcher whose responses the test resolves by hand, oldest first. */
function deferredFetcher() {
  const pending: Array<{ resolve: (rows: Rows) => void; reject: (err: Error) => void }> = [];
  const fetcher = vi.fn(
    () =>
      new Promise<Rows>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  const respond = async (rows: Rows) => {
    pending.shift()!.resolve(rows);
    await flush();
  };
  const fail = async (message: string) => {
    pending.shift()!.reject(new Error(message));
    await flush();
  };
  return { fetcher, respond, fail, pending };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await nextTick();
}

const scopes: EffectScope[] = [];

/** Mount the composable in a scope, like a component would. */
function mountQuery(
  fetcher: () => Promise<Rows>,
  key: ["conversations", ...unknown[]] = ["conversations", "list"],
) {
  const scope = effectScope();
  scopes.push(scope);
  const query = scope.run(() => useCachedQuery(() => key, fetcher))!;
  return { query, unmount: () => scope.stop() };
}

function signIn(userId: string, organizationId: string) {
  const store = useUserStore();
  store.$patch({
    user: { id: userId, email: "x@example.com" },
    activeOrganizationId: organizationId,
    organizations: [
      { id: "org-a", name: "A", slug: "a" },
      { id: "org-b", name: "B", slug: "b" },
    ],
  });
  return store;
}

describe("useCachedQuery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("useTelemetry", () => ({
      identify: vi.fn(),
      setOrganization: vi.fn(),
      reset: vi.fn(),
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    setActivePinia(createPinia());
    clearQueryCache();
    signIn("user-1", "org-a");
  });

  afterEach(() => {
    scopes.splice(0).forEach((scope) => scope.stop());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is loading with no data on the first ever fetch, so pages can avoid false zeros", async () => {
    const api = deferredFetcher();
    const { query } = mountQuery(api.fetcher);

    expect(query.data.value).toBeUndefined();
    expect(query.loading.value).toBe(true);
    expect(query.refreshing.value).toBe(false);

    await api.respond(["a"]);

    expect(query.data.value).toEqual(["a"]);
    expect(query.loading.value).toBe(false);
  });

  it("shows cached data at once when reopened and marks it refreshing", async () => {
    const api = deferredFetcher();
    const first = mountQuery(api.fetcher);
    await api.respond(["a"]);
    first.unmount();

    const second = mountQuery(api.fetcher);

    expect(second.query.data.value).toEqual(["a"]);
    expect(second.query.loading.value).toBe(false);
    expect(second.query.refreshing.value).toBe(true);
    expect(api.fetcher).toHaveBeenCalledTimes(2);
  });

  it("replaces cached data when revalidation brings something new", async () => {
    const api = deferredFetcher();
    const first = mountQuery(api.fetcher);
    await api.respond(["a"]);
    first.unmount();

    const { query } = mountQuery(api.fetcher);
    await api.respond(["a", "b"]);

    expect(query.data.value).toEqual(["a", "b"]);
    expect(query.refreshing.value).toBe(false);
  });

  it("keeps cached data on screen when revalidation fails", async () => {
    const api = deferredFetcher();
    const first = mountQuery(api.fetcher);
    await api.respond(["a"]);
    first.unmount();

    const { query } = mountQuery(api.fetcher);
    await api.fail("server down");

    expect(query.data.value).toEqual(["a"]);
    expect(query.error.value).toBeInstanceOf(Error);
    expect(query.refreshing.value).toBe(false);
  });

  it("collapses identical concurrent queries into one request", async () => {
    const api = deferredFetcher();
    const one = mountQuery(api.fetcher);
    const two = mountQuery(api.fetcher);
    const three = mountQuery(api.fetcher);

    expect(api.fetcher).toHaveBeenCalledTimes(1);

    await api.respond(["shared"]);

    expect(one.query.data.value).toEqual(["shared"]);
    expect(two.query.data.value).toEqual(["shared"]);
    expect(three.query.data.value).toEqual(["shared"]);
  });

  it("keeps filters apart: each parameter set has its own entry", async () => {
    const api = deferredFetcher();
    const status = ref("open");
    const scope = effectScope();
    scopes.push(scope);
    const query = scope.run(() =>
      useCachedQuery(
        () => ["conversations", "list", { status: status.value }] as const,
        api.fetcher,
      ),
    )!;
    await api.respond(["open row"]);

    status.value = "closed";
    expect(query.data.value).toBeUndefined();
    expect(query.loading.value).toBe(true);
    await flush();
    expect(api.fetcher).toHaveBeenCalledTimes(2);
    await api.respond(["closed row"]);
    expect(query.data.value).toEqual(["closed row"]);

    status.value = "open";
    expect(query.data.value).toEqual(["open row"]);
    await flush();
    expect(query.refreshing.value).toBe(true);
  });

  it("builds each request from its own key, not from current filters", async () => {
    const status = ref("open");
    const fetcher = vi.fn((key: readonly ["conversations", { status: string }]) =>
      Promise.resolve([key[1].status]),
    );
    const scope = effectScope();
    scopes.push(scope);
    const query = scope.run(() =>
      useCachedQuery(() => ["conversations", { status: status.value }] as const, fetcher),
    )!;
    await flush();

    status.value = "closed";
    await flush();

    expect(fetcher.mock.calls.map(([key]) => key[1].status)).toEqual(["open", "closed"]);
    expect(query.data.value).toEqual(["closed"]);
  });

  it("waits while the key is null", async () => {
    const api = deferredFetcher();
    const range = ref<string | null>(null);
    const scope = effectScope();
    scopes.push(scope);
    const query = scope.run(() =>
      useCachedQuery(
        () => (range.value ? (["analytics", range.value] as const) : null),
        api.fetcher,
      ),
    )!;
    await flush();

    expect(api.fetcher).not.toHaveBeenCalled();
    expect(query.loading.value).toBe(true);

    range.value = "2026-11";
    await flush();

    expect(api.fetcher).toHaveBeenCalledTimes(1);
  });

  it("refreshes again after a running request when the data changed meanwhile", async () => {
    const api = deferredFetcher();
    const { query } = mountQuery(api.fetcher);

    void query.refresh();
    void query.refresh();
    expect(api.fetcher).toHaveBeenCalledTimes(1);

    await api.respond(["older"]);
    expect(query.data.value).toEqual(["older"]);
    expect(api.fetcher).toHaveBeenCalledTimes(2);
    expect(query.refreshing.value).toBe(true);

    await api.respond(["newest"]);
    expect(query.data.value).toEqual(["newest"]);
    expect(api.fetcher).toHaveBeenCalledTimes(2);
    expect(query.refreshing.value).toBe(false);
  });

  it("replays a live update made during a request on top of its response", async () => {
    const api = deferredFetcher();
    const first = mountQuery(api.fetcher);
    await api.respond(["a"]);
    first.unmount();

    const { query } = mountQuery(api.fetcher);
    query.setData((rows) => (rows.includes("live") ? rows : ["live", ...rows]));
    expect(query.data.value).toEqual(["live", "a"]);

    await api.respond(["a"]);
    expect(query.data.value).toEqual(["live", "a"]);
  });

  describe("organization isolation", () => {
    it("never shows one organization's data in another", async () => {
      const api = deferredFetcher();
      const { query } = mountQuery(api.fetcher);
      await api.respond(["secret of A"]);

      useUserStore().activeOrganizationId = "org-b";

      expect(query.data.value).toBeUndefined();
      expect(query.loading.value).toBe(true);
    });

    it("discards a response that arrives after the organization changed", async () => {
      const api = deferredFetcher();
      const { query } = mountQuery(api.fetcher);

      useUserStore().activeOrganizationId = "org-b";
      await flush();
      await api.respond(["response from A"]);

      expect(query.data.value).toBeUndefined();

      await api.respond(["response from B"]);
      expect(query.data.value).toEqual(["response from B"]);
    });

    it("does not serve one organization's cache after switching there and back", async () => {
      const api = deferredFetcher();
      const { query } = mountQuery(api.fetcher);
      await api.respond(["A"]);

      const store = useUserStore();
      store.activeOrganizationId = "org-b";
      await flush();
      await api.respond(["B"]);
      store.activeOrganizationId = "org-a";

      expect(query.data.value).toBeUndefined();
    });

    it("keeps users apart on the same organization", async () => {
      const api = deferredFetcher();
      const { query } = mountQuery(api.fetcher);
      await api.respond(["seen by user 1"]);

      signIn("user-2", "org-a");

      expect(query.data.value).toBeUndefined();
    });

    it("empties the cache when the user store is cleared on logout", async () => {
      const api = deferredFetcher();
      const first = mountQuery(api.fetcher);
      await api.respond(["private"]);
      first.unmount();

      useUserStore().clearUser();
      signIn("user-1", "org-a");

      const { query } = mountQuery(api.fetcher);
      expect(query.data.value).toBeUndefined();
      expect(query.loading.value).toBe(true);
    });

    it("empties the cache when the store switches organization", async () => {
      const api = deferredFetcher();
      const first = mountQuery(api.fetcher);
      await api.respond(["A"]);
      first.unmount();

      const store = useUserStore();
      await store.switchOrganization("org-b");
      store.activeOrganizationId = "org-a";

      const { query } = mountQuery(api.fetcher);
      expect(query.data.value).toBeUndefined();
    });
  });

  describe("invalidation", () => {
    it("discards a response that started before a mutation finished, then refetches", async () => {
      const api = deferredFetcher();
      const { query } = mountQuery(api.fetcher);
      await api.respond(["open"]);

      void query.refresh();
      expect(api.fetcher).toHaveBeenCalledTimes(2);

      invalidateForMutation("conversations.close");
      await api.respond(["open (read before the close)"]);

      expect(query.data.value).toEqual(["open"]);
      expect(query.refreshing.value).toBe(true);

      vi.advanceTimersByTime(200);
      expect(api.fetcher).toHaveBeenCalledTimes(3);
      await api.respond(["closed"]);

      expect(query.data.value).toEqual(["closed"]);
      expect(query.refreshing.value).toBe(false);
    });

    it("keeps mounted data visible while it refetches", async () => {
      const api = deferredFetcher();
      const { query } = mountQuery(api.fetcher);
      await api.respond(["row"]);

      invalidateQueries(["conversations"]);

      expect(query.data.value).toEqual(["row"]);
      expect(query.loading.value).toBe(false);
    });

    it("drops lists nobody is showing, so reopening cannot contradict the mutation", async () => {
      const api = deferredFetcher();
      const first = mountQuery(api.fetcher);
      await api.respond(["open"]);
      first.unmount();

      invalidateForMutation("conversations.close");

      const { query } = mountQuery(api.fetcher);
      expect(query.data.value).toBeUndefined();
      expect(query.loading.value).toBe(true);
    });

    it("coalesces serial mutations into one refetch", async () => {
      const api = deferredFetcher();
      mountQuery(api.fetcher, ["documents", "list"]);
      await api.respond(["d1", "d2"]);

      invalidateForMutation("documents.delete");
      invalidateForMutation("documents.delete");
      invalidateForMutation("documents.delete");
      vi.advanceTimersByTime(200);

      expect(api.fetcher).toHaveBeenCalledTimes(2);
    });

    it("leaves other groups and non-list mutations alone", async () => {
      const api = deferredFetcher();
      const { query } = mountQuery(api.fetcher);
      await api.respond(["row"]);

      invalidateForMutation("documents.delete");
      invalidateForMutation("conversations.sendMessage");
      invalidateForMutation("organizations.updateSettings");
      vi.advanceTimersByTime(200);

      expect(api.fetcher).toHaveBeenCalledTimes(1);
      expect(query.refreshing.value).toBe(false);
    });
  });

  it("stops showing entries older than the maximum age", async () => {
    const api = deferredFetcher();
    const first = mountQuery(api.fetcher);
    await api.respond(["yesterday"]);
    first.unmount();

    vi.advanceTimersByTime(MAX_AGE_MS + 1);

    const { query } = mountQuery(api.fetcher);
    expect(query.data.value).toBeUndefined();
    expect(query.loading.value).toBe(true);
  });

  it("writes nothing to browser storage", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem, getItem: () => null, removeItem: vi.fn() });
    vi.stubGlobal("sessionStorage", { setItem, getItem: () => null, removeItem: vi.fn() });
    const api = deferredFetcher();
    mountQuery(api.fetcher);

    await api.respond(["customer pii"]);

    expect(setItem).not.toHaveBeenCalled();
  });
});
