/**
 * In-process mutual exclusion per key: callers with the same key run one at a
 * time, in arrival order; different keys do not wait for each other.
 */
const tails = new Map<string, Promise<unknown>>();

export async function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}
