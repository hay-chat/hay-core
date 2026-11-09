import {
  computed,
  getCurrentScope,
  onScopeDispose,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
} from "vue";
import { useUserStore } from "@/stores/user";
import {
  dropIfExpired,
  getQueryEntry,
  patchEntry,
  refreshEntry,
  revalidateEntry,
  type QueryEntry,
  type QueryKey,
} from "@/utils/query-cache";

export interface CachedQuery<T> {
  /** Cached or fresh data; undefined until the first response for this key. */
  data: ComputedRef<T | undefined>;
  /** No data to show yet: render a skeleton, never zeros or an empty state. */
  loading: ComputedRef<boolean>;
  /** Fetching behind data that is already on screen. */
  refreshing: ComputedRef<boolean>;
  error: ComputedRef<unknown>;
  /** Identifies the current key. Changes with filters, pages and organization. */
  keyHash: ComputedRef<string | null>;
  /** Fetch again because the data is known to have changed (user refresh, live event). */
  refresh: () => Promise<void>;
  /** Change the cached data locally. The updater must be safe to run twice. */
  setData: (updater: (data: T) => T) => void;
}

/**
 * Stale-while-revalidate read of an API query: shows the cached result at once
 * and refetches behind it. Identical concurrent queries share one request, and
 * successful mutations invalidate affected queries (see utils/query-cache.ts).
 *
 * `key` holds everything the result depends on (filters, page, date range),
 * with the group first. The organization and user are added automatically.
 * `fetcher` must build its request from the key alone, never from refs: an
 * in-flight refetch can outlive the filters that started it. A null key waits.
 *
 * Keep keys stable: `["analytics", "today", "2026-11-09"]`, not `Date.now()`.
 */
export function useCachedQuery<K extends QueryKey, T>(
  key: MaybeRefOrGetter<K | null>,
  fetcher: (key: K) => Promise<T>,
): CachedQuery<T> {
  const userStore = useUserStore();

  const scope = computed(() => {
    const userId = userStore.user?.id;
    const organizationId = userStore.activeOrganizationId || userStore.organizations[0]?.id;
    return userId && organizationId ? `${userId}:${organizationId}` : null;
  });

  // A computed, so a new key or organization shows the right entry in the same
  // render: data from the previous organization cannot be painted in between.
  const entry = computed<QueryEntry<T> | null>(() => {
    const currentKey = toValue(key);
    if (!currentKey || !scope.value) return null;
    const found = getQueryEntry<T>(scope.value, currentKey);
    found.fetcher = () => fetcher(currentKey);
    return found;
  });

  let subscribed: QueryEntry<T> | null = null;
  const unsubscribe = () => {
    if (subscribed) subscribed.subscribers--;
    subscribed = null;
  };

  watch(
    entry,
    (current) => {
      unsubscribe();
      if (!current) return;
      subscribed = current;
      current.subscribers++;
      dropIfExpired(current);
      void revalidateEntry(current);
    },
    { immediate: true },
  );

  if (getCurrentScope()) onScopeDispose(unsubscribe);

  const data = computed(() => entry.value?.data);

  return {
    data,
    loading: computed(() => data.value === undefined && !entry.value?.error),
    refreshing: computed(() => data.value !== undefined && !!entry.value?.fetching),
    error: computed(() => entry.value?.error),
    keyHash: computed(() => entry.value?.hash ?? null),
    refresh: () => (entry.value ? refreshEntry(entry.value) : Promise.resolve()),
    setData: (updater) => {
      if (entry.value) patchEntry(entry.value, updater);
    },
  };
}
