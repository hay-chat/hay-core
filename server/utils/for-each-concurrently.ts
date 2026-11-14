/**
 * Run `worker` over `items` with at most `limit` calls in flight, in order of
 * `items`. Once `shouldStop()` returns true no new item is started; items
 * already running are awaited.
 *
 * Returns true when every item was started (and finished), false when it
 * stopped early.
 */
export async function forEachConcurrently<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<boolean> {
  let next = 0;
  const runner = async (): Promise<void> => {
    while (next < items.length && !shouldStop()) {
      const item = items[next++];
      await worker(item);
    }
  };
  const runners = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: runners }, runner));
  return next >= items.length;
}
