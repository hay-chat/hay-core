import type { ReportRange } from "@/utils/analytics";

/**
 * One analytics report for a date range, cached like the rest of the
 * dashboard. `fetcher` gets the range from the key, never from a ref.
 */
export function useAnalyticsReport<T>(
  name: string,
  range: () => ReportRange | null,
  fetcher: (range: ReportRange) => Promise<T>,
) {
  const query = useCachedQuery(
    () => {
      const current = range();
      return current ? (["analytics", name, current] as const) : null;
    },
    ([, , current]) => fetcher(current),
  );
  return {
    data: query.data,
    // No range yet counts as loading: the selector fills it in on mount.
    loading: computed(() => !query.data.value && !query.error.value),
    failed: computed(() => !query.data.value && !!query.error.value),
    refreshing: query.refreshing,
    refresh: query.refresh,
  };
}
