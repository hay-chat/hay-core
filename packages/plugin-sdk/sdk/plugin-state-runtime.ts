/**
 * Hay Plugin SDK - Plugin State Runtime API
 *
 * HTTP client backing `HayGlobalContext.state`: the worker's own key/value
 * store in core (`pluginApi.state.*`), scoped by core to the organization and
 * plugin in the HAY_API_TOKEN JWT.
 *
 * @module @hay/plugin-sdk/sdk/plugin-state-runtime
 */

import type { HayPluginStateAPI, HayPluginStateSetOptions } from "../types/index.js";

export interface PluginStateRuntimeOptions {
  apiUrl: string;
  apiToken: string;
  /** Override fetch for testing. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export function createPluginStateRuntime(options: PluginStateRuntimeOptions): HayPluginStateAPI {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const { apiUrl, apiToken } = options;

  async function call(procedure: string, input: unknown): Promise<unknown> {
    const res = await fetchImpl(`${apiUrl.replace(/\/$/, "")}/v1/pluginApi.state.${procedure}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`state.${procedure} HTTP ${res.status}: ${text || res.statusText}`);
    }
    const json = (await res.json()) as { result?: { data?: unknown } };
    return json.result?.data ?? null;
  }

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const data = (await call("get", { key })) as { value?: T | null } | null;
      return data?.value ?? null;
    },
    async set(key: string, value: unknown, opts: HayPluginStateSetOptions = {}): Promise<void> {
      await call("set", { key, value, ttlMs: opts.ttlMs });
    },
    async delete(key: string): Promise<void> {
      await call("delete", { key });
    },
  };
}
