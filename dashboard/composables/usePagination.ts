import { useAppStore } from "@/stores/app";

/**
 * Pagination state that is reflected in the URL query (`?page=&perPage=`) and
 * whose page-size preference is persisted globally via the app store.
 *
 * - Initial state reads from the URL first, then falls back to the persisted
 *   `rowsPerPage` preference, so deep links and browser back/forward restore
 *   the exact list state.
 * - Changing the page size resets to page 1 and persists the choice globally.
 */
export function usePagination() {
  const route = useRoute();
  const router = useRouter();
  const appStore = useAppStore();

  const toPositiveInt = (value: unknown, fallback: number): number => {
    const raw = Array.isArray(value) ? value[0] : value;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };

  const page = ref(toPositiveInt(route.query.page, 1));
  const pageSize = ref(toPositiveInt(route.query.perPage, appStore.rowsPerPage));

  const syncUrl = () => {
    router.replace({
      query: {
        ...route.query,
        page: String(page.value),
        perPage: String(pageSize.value),
      },
    });
  };

  const setPage = (value: number) => {
    page.value = value;
    syncUrl();
  };

  const setPageSize = (value: number) => {
    pageSize.value = value;
    page.value = 1; // Reset to first page when the page size changes
    appStore.setRowsPerPage(value); // Persist the preference across the app
    syncUrl();
  };

  return { page, pageSize, setPage, setPageSize };
}
