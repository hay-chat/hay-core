import { describe, it, expect } from "@jest/globals";
import { forEachConcurrently } from "@server/utils/for-each-concurrently";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("forEachConcurrently", () => {
  it("runs every item, never more than `limit` at once, starting them in order", async () => {
    let running = 0;
    let maxRunning = 0;
    const started: number[] = [];

    const allStarted = await forEachConcurrently([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      started.push(n);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await tick();
      running -= 1;
    });

    expect(allStarted).toBe(true);
    expect(started).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(maxRunning).toBe(3);
  });

  it("starts nothing new once shouldStop is true, but lets running items finish", async () => {
    const finished: number[] = [];
    let stop = false;

    const allStarted = await forEachConcurrently(
      [1, 2, 3, 4, 5],
      2,
      async (n) => {
        await tick();
        finished.push(n);
        if (n === 1) stop = true; // 1 and 2 are already running
      },
      () => stop,
    );

    expect(allStarted).toBe(false);
    expect(finished.sort()).toEqual([1, 2]);
  });

  it("handles an empty list", async () => {
    expect(await forEachConcurrently([], 4, async () => undefined)).toBe(true);
  });
});
