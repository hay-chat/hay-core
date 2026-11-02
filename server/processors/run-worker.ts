import { Worker } from "node:worker_threads";
import { DocumentRejectedError } from "./base.processor";

export interface WorkerLimits {
  /** Wall-clock budget; the thread is terminated when it runs out. */
  timeoutMs: number;
  /** V8 heap cap for the thread; exceeding it ends the thread. */
  maxOldGenerationSizeMb: number;
}

/**
 * Run `filename` in a worker thread and resolve with the first message it
 * posts. The thread is always terminated once settled, so a parser stuck in a
 * loop or growing without bound stops using CPU and memory.
 *
 * TypeScript entries (dev, tests) are loaded through tsx; the build runs the
 * compiled .js entry directly.
 */
export function runWorker<T>(
  filename: string,
  workerData: unknown,
  limits: WorkerLimits,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const typescript = filename.endsWith(".ts");
    const worker = new Worker(
      typescript ? `require("tsx/cjs"); require(${JSON.stringify(filename)});` : filename,
      {
        eval: typescript,
        workerData,
        resourceLimits: { maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb },
      },
    );

    let settled = false;
    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().then(outcome, outcome);
    };

    const timer = setTimeout(
      () => settle(() => reject(new DocumentRejectedError("Document took too long to process"))),
      limits.timeoutMs,
    );
    worker.once("message", (result: T) => settle(() => resolve(result)));
    worker.once("error", (error: Error & { code?: string }) =>
      settle(() =>
        reject(
          error.code === "ERR_WORKER_OUT_OF_MEMORY"
            ? new DocumentRejectedError("Document needs too much memory to process")
            : error,
        ),
      ),
    );
    worker.once("exit", (code) =>
      settle(() => reject(new Error(`Document parser stopped unexpectedly (exit code ${code})`))),
    );
  });
}
