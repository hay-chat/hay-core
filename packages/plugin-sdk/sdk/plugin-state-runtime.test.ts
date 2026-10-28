import { describe, it, expect } from "vitest";
import { createPluginStateRuntime } from "./plugin-state-runtime";

function fakeFetch(responses: unknown[]) {
  const calls: Array<{ url: string; body: unknown; auth: string | null }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init.body)),
      auth: new Headers(init.headers).get("authorization"),
    });
    return new Response(JSON.stringify({ result: { data: responses.shift() } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("createPluginStateRuntime", () => {
  it("calls core's state procedures with the worker token", async () => {
    const { calls, impl } = fakeFetch([{ ok: true }, { value: { a: 1 } }, { ok: true }]);
    const state = createPluginStateRuntime({
      apiUrl: "http://core/",
      apiToken: "jwt",
      fetchImpl: impl,
    });

    await state.set("k", { a: 1 }, { ttlMs: 1000 });
    expect(await state.get("k")).toEqual({ a: 1 });
    await state.delete("k");

    expect(calls.map((c) => c.url)).toEqual([
      "http://core/v1/pluginApi.state.set",
      "http://core/v1/pluginApi.state.get",
      "http://core/v1/pluginApi.state.delete",
    ]);
    expect(calls[0].body).toEqual({ key: "k", value: { a: 1 }, ttlMs: 1000 });
    expect(calls[0].auth).toBe("Bearer jwt");
  });

  it("returns null for a missing key and throws on HTTP errors", async () => {
    const { impl } = fakeFetch([{ value: null }]);
    const state = createPluginStateRuntime({ apiUrl: "http://core", apiToken: "t", fetchImpl: impl });
    expect(await state.get("missing")).toBeNull();

    const failing = createPluginStateRuntime({
      apiUrl: "http://core",
      apiToken: "t",
      fetchImpl: (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch,
    });
    await expect(failing.get("k")).rejects.toThrow("state.get HTTP 401");
  });
});
