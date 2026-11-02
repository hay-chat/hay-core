import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  issueWorkerSecret,
  revokeWorkerSecret,
  workerAuthHeaders,
  workerFetch,
  WORKER_SECRET_HEADER,
} from "@server/lib/worker-client";

describe("worker client", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("calls the worker on loopback with its secret and the caller's headers", async () => {
    const secret = issueWorkerSecret(41001);
    const mockFetch = jest.fn(async () => new Response("{}"));
    global.fetch = mockFetch as unknown as typeof fetch;

    await workerFetch(41001, "/mcp/list-tools?x=1", {
      method: "POST",
      headers: { "Content-Type": "application/json", [WORKER_SECRET_HEADER]: "spoofed" },
    });

    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:41001/mcp/list-tools?x=1");
    const headers = new Headers(init.headers);
    expect(headers.get(WORKER_SECRET_HEADER)).toBe(secret);
    expect(headers.get("content-type")).toBe("application/json");
    revokeWorkerSecret(41001, secret);
  });

  it("mints a distinct secret per worker", () => {
    const a = issueWorkerSecret(41002);
    const b = issueWorkerSecret(41003);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    revokeWorkerSecret(41002, a);
    revokeWorkerSecret(41003, b);
  });

  it("keeps a newer worker's secret when an old worker on the same port exits late", () => {
    const old = issueWorkerSecret(41004);
    const current = issueWorkerSecret(41004);
    revokeWorkerSecret(41004, old);
    expect(workerAuthHeaders(41004)).toEqual({ [WORKER_SECRET_HEADER]: current });
    revokeWorkerSecret(41004, current);
    expect(workerAuthHeaders(41004)).toEqual({});
  });
});
