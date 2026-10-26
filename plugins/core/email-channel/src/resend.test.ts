import { describe, expect, it, vi } from "vitest";
import { ResendApiError, ResendClient } from "./resend.js";

function client(responses: Array<() => Response | Error>) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("unexpected call");
    }
    const result = next();
    if (result instanceof Error) {
      throw result;
    }
    return result;
  });
  const sleeps: number[] = [];
  const resend = new ResendClient({
    apiKey: "re_test",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    retryDelaysMs: [1, 2],
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { resend, fetchImpl, sleeps };
}

const ok = () =>
  new Response(JSON.stringify({ id: "email-1", from: "a@b.c", to: [] }), { status: 200 });

describe("ResendClient retries", () => {
  it("retries 5xx, 429 and network errors with backoff, then succeeds", async () => {
    const { resend, fetchImpl, sleeps } = client([
      () => new Response("busy", { status: 503 }),
      () => new TypeError("fetch failed"),
      ok,
    ]);

    await expect(resend.getReceivedEmail("email-1")).resolves.toMatchObject({ id: "email-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1, 2]);
  });

  it("gives up after the configured attempts", async () => {
    const { resend, fetchImpl } = client([
      () => new Response("", { status: 429 }),
      () => new Response("", { status: 500 }),
      () => new Response("", { status: 502 }),
    ]);

    await expect(resend.getReceivedEmail("email-1")).rejects.toBeInstanceOf(ResendApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 4xx that will not change", async () => {
    const { resend, fetchImpl, sleeps } = client([() => new Response("gone", { status: 404 })]);

    await expect(resend.getReceivedEmail("email-1")).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });
});
