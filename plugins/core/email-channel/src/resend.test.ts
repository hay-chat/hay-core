import { describe, expect, it, vi } from "vitest";
import type { PluginApi } from "./plugin-api.js";
import { PluginApiError } from "./plugin-api.js";
import { ResendClient } from "./resend.js";

function client(responses: Array<() => unknown | Error>) {
  const query = vi.fn(async () => {
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
    api: { query, mutation: vi.fn(), sendEmail: vi.fn() } as unknown as PluginApi,
    retryDelaysMs: [1, 2],
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { resend, query, sleeps };
}

const ok = () => ({ id: "email-1", from: "a@b.c", to: [] });
const failure = (status: number) => new PluginApiError(`failed: ${status}`, status);

describe("ResendClient retries", () => {
  it("retries 5xx, 429 and network errors with backoff, then succeeds", async () => {
    const { resend, query, sleeps } = client([
      () => failure(503),
      () => new TypeError("fetch failed"),
      ok,
    ]);

    await expect(resend.getReceivedEmail("email-1")).resolves.toMatchObject({ id: "email-1" });
    expect(query).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1, 2]);
  });

  it("gives up after the configured attempts", async () => {
    const { resend, query } = client([() => failure(429), () => failure(500), () => failure(502)]);

    await expect(resend.getReceivedEmail("email-1")).rejects.toBeInstanceOf(PluginApiError);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("lists attachments from core", async () => {
    const { resend, query } = client([() => ({ attachments: [{ id: "a1" }] })]);

    await expect(resend.listAttachments("email-1")).resolves.toEqual([{ id: "a1" }]);
    expect(query).toHaveBeenCalledWith("email.receivedAttachments", { emailId: "email-1" });
  });

  it("does not retry a 4xx that will not change", async () => {
    const { resend, query, sleeps } = client([() => failure(404)]);

    await expect(resend.getReceivedEmail("email-1")).rejects.toMatchObject({ status: 404 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });
});
