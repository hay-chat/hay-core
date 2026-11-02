import { describe, it, expect } from "@jest/globals";
import path from "path";
import { runWorker } from "@server/processors/run-worker";
import { DocumentRejectedError } from "@server/processors";

const fixture = (name: string) => path.join(__dirname, "fixtures", name);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("runWorker", () => {
  it("terminates a parser that never finishes and rejects the document", async () => {
    const counter = new SharedArrayBuffer(4);
    const view = new Int32Array(counter);
    const started = Date.now();

    await expect(
      runWorker(
        fixture("spin.worker.js"),
        { counter },
        { timeoutMs: 300, maxOldGenerationSizeMb: 64 },
      ),
    ).rejects.toThrow(new DocumentRejectedError("Document took too long to process"));
    expect(Date.now() - started).toBeLessThan(5_000);

    // The thread is gone: the loop no longer advances.
    const afterReject = Atomics.load(view, 0);
    expect(afterReject).toBeGreaterThan(0);
    await sleep(200);
    expect(Atomics.load(view, 0)).toBe(afterReject);
  });

  it("rejects a parser that exceeds its memory limit", async () => {
    await expect(
      runWorker(fixture("hog.worker.js"), {}, { timeoutMs: 30_000, maxOldGenerationSizeMb: 32 }),
    ).rejects.toThrow(new DocumentRejectedError("Document needs too much memory to process"));
  });

  it("passes a parser error through", async () => {
    await expect(
      runWorker(fixture("throw.worker.js"), {}, { timeoutMs: 5_000, maxOldGenerationSizeMb: 64 }),
    ).rejects.toThrow("Malformed document");
  });
});
