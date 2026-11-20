/**
 * A worker's event stream is quiet for as long as the worker is, so it must not
 * be cut off by the default five-minute body timeout; ordinary calls keep it.
 */
import { describe, expect, it, jest } from "@jest/globals";

const agentOptions: Array<Record<string, unknown>> = [];
jest.mock("undici", () => ({
  Agent: class {
    constructor(options: Record<string, unknown>) {
      agentOptions.push(options);
    }
    close() {
      return Promise.resolve();
    }
  },
  fetch: jest.fn(async () => new Response("{}")),
}));

import { socketFetch } from "@server/lib/worker-client";

describe("socketFetch", () => {
  it("lifts the body timeout only for a streaming response", async () => {
    await socketFetch("/run/a.sock", "http://host/status");
    await socketFetch("/run/a.sock", "http://host/events", {}, { stream: true });
    await socketFetch("/run/a.sock", "http://host/events", {}, { stream: true });

    expect(agentOptions).toEqual([
      { connect: { socketPath: "/run/a.sock" } },
      { connect: { socketPath: "/run/a.sock" }, bodyTimeout: 0 },
    ]);
  });
});
