import { shallowRef, watch, type MaybeRefOrGetter, toValue } from "vue";

/**
 * Which rows just appeared in a list, so they can enter with `.data-settle`.
 *
 * Only additions to the same list count. The first load, a change of filter or
 * page (`listKey`) and refetches that add nothing mark no row as new.
 *
 * `rows` is undefined while the list has not loaded.
 */
export function useNewRows<T extends { id: string }>(
  rows: MaybeRefOrGetter<readonly T[] | undefined>,
  listKey: MaybeRefOrGetter<string | null>,
) {
  const newIds = shallowRef<ReadonlySet<string>>(new Set());
  let known: ReadonlySet<string> | null = null;
  let knownKey: string | null = null;

  watch(
    [() => toValue(rows), () => toValue(listKey)],
    ([current, key]) => {
      const ids = current ? new Set(current.map((row) => row.id)) : null;
      const sameList = key === knownKey && known !== null && ids !== null;
      const added = sameList ? [...ids].filter((id) => !known!.has(id)) : [];
      if (added.length > 0 || newIds.value.size > 0) newIds.value = new Set(added);
      known = ids;
      knownKey = key;
    },
    { immediate: true },
  );

  return (id: string) => newIds.value.has(id);
}
