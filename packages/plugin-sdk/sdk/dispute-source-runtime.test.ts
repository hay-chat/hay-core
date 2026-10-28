import { describe, it, expect } from "vitest";
import { createDisputeSourceRuntime } from "./dispute-source-runtime.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe("createDisputeSourceRuntime", () => {
  it("posts the dispute to pluginApi.disputes.report with the plugin token", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ result: { data: { created: true } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = createDisputeSourceRuntime({
      apiUrl: "http://core:3001/",
      apiToken: "tok",
      logger: silent,
      fetchImpl,
    });
    const result = await api.report({ externalId: "dp_1", status: "needs_response" });
    expect(result).toEqual({ created: true });
    expect(calls[0].url).toBe("http://core:3001/v1/pluginApi.disputes.report");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      externalId: "dp_1",
      status: "needs_response",
    });
  });

  it("throws on an HTTP error so the caller can retry", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    const api = createDisputeSourceRuntime({ apiUrl: "http://x", apiToken: "t", logger: silent, fetchImpl });
    await expect(api.report({ externalId: "dp_1", status: "won" })).rejects.toThrow(/HTTP 403/);
  });
});
