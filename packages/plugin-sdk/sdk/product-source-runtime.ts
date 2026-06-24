/**
 * Hay Plugin SDK - Product Source Runtime API
 *
 * HTTP client backing `HayStartContext.productSource`. Pushes CanonicalProduct
 * payloads to core's plugin-api tRPC router using the JWT injected via
 * HAY_API_TOKEN (capability-scoped to `products`).
 *
 * @module @hay/plugin-sdk/sdk/product-source-runtime
 */

import type { CanonicalProduct, HayLogger, HayProductSourceRuntimeAPI } from "../types/index.js";

export interface ProductSourceRuntimeOptions {
  apiUrl: string;
  apiToken: string;
  logger: HayLogger;
  /** Override fetch for testing. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Build a HayProductSourceRuntimeAPI for the plugin worker.
 *
 * Calls core's `pluginApi.products.upsertMany` and `pluginApi.products.delete`
 * over HTTP+JSON. The token is sent as `Authorization: Bearer <jwt>` and
 * carries the `products` capability that the server's plugin-auth middleware
 * checks.
 */
export function createProductSourceRuntime(
  options: ProductSourceRuntimeOptions,
): HayProductSourceRuntimeAPI {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const { apiUrl, apiToken, logger } = options;

  if (!fetchImpl) {
    throw new Error("ProductSourceRuntime: no fetch implementation available");
  }

  async function call(procedure: string, input: unknown): Promise<unknown> {
    const url = `${apiUrl.replace(/\/$/, "")}/v1/pluginApi.${procedure}`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`productSource ${procedure} HTTP ${res.status}: ${text || res.statusText}`);
    }
    const json = (await res.json()) as { result?: { data?: unknown } };
    // tRPC HTTP envelope: { result: { data: <returned> } }
    return (json.result?.data ?? json) as unknown;
  }

  return {
    async upsert(products: CanonicalProduct[]): Promise<{ upserted: number; errors: number }> {
      if (!products.length) return { upserted: 0, errors: 0 };
      logger.debug("Pushing products to core", { count: products.length });
      const data = (await call("products.upsertMany", { products })) as {
        upserted: number;
        errors: Array<unknown>;
      };
      return {
        upserted: data?.upserted ?? 0,
        errors: Array.isArray(data?.errors) ? data.errors.length : 0,
      };
    },

    async delete(externalId: string): Promise<{ removed: boolean }> {
      // Source is derived server-side from the authenticated plugin id.
      const data = (await call("products.delete", { externalId })) as {
        removed: boolean;
      };
      return { removed: Boolean(data?.removed) };
    },
  };
}
