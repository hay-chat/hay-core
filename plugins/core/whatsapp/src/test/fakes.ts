import { vi } from "vitest";
import type { HayLogger } from "@hay/plugin-sdk/types";

export function fakeLogger(): HayLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as HayLogger;
}

/** A fetch stub answering each call from a queue of `[status, json]` responses. */
export function queuedFetch(responses: Array<[number, unknown]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) {
      throw new Error(`Unexpected fetch ${String(url)}`);
    }
    const [status, body] = next;
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}
