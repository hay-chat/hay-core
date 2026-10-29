/**
 * Small Nuvemshop REST client for the seed script, on top of lib/data.ts `http`.
 * Same quirks as the plugin (plugins/core/nuvemshop/mcp/lib/client.js): base
 * https://api.nuvemshop.com.br/{version}/{store_id}, header `Authentication: bearer <token>`
 * (not Authorization), a mandatory User-Agent, 429 under the ~2 req/s leaky bucket, and list
 * endpoints that 404 past the last page. Dry-run never sends anything (no GETs either).
 */
import { http, type Flags } from "../lib/data";

export const API_HOST = "https://api.nuvemshop.com.br";
export const DEFAULT_API_VERSION = "2025-03";
export const USER_AGENT = "Hay.chat demo seed (hello@hay.chat)";
const MAX_ATTEMPTS = 5;

export interface Nuvemshop {
  dryRun: boolean;
  get<T>(path: string, query?: Record<string, string | number>): Promise<T>;
  /** Every page of a list endpoint; a 404 past the last page ends the list. */
  list<T>(path: string, query?: Record<string, string | number>): Promise<T[]>;
  write<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body: unknown, dryRunResult: T): Promise<T>;
}

export interface NuvemshopConfig {
  storeId: string;
  accessToken: string;
  apiVersion?: string;
}

/** HTTP status out of an `http` error ("GET url → 404: ..."), or null. */
export function statusOf(err: unknown): number | null {
  const match = / → (\d{3}):/.exec(err instanceof Error ? err.message : String(err));
  return match ? Number(match[1]) : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createNuvemshop(
  flags: Flags,
  config: NuvemshopConfig,
  options: { retryDelayMs?: number } = {},
): Nuvemshop {
  const base = `${API_HOST}/${config.apiVersion ?? DEFAULT_API_VERSION}/${config.storeId || "<store_id>"}`;
  const headers = { Authentication: `bearer ${config.accessToken}`, "User-Agent": USER_AGENT };
  const retryDelayMs = options.retryDelayMs ?? 2000;

  function url(path: string, query: Record<string, string | number> = {}): string {
    const u = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
    return u.toString();
  }

  async function call<T>(method: string, target: string, body?: unknown, dryRunResult?: T): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await http<T>(flags, method, target, { headers, body, dryRunResult });
      } catch (err) {
        // 429 was never processed, so any method may retry.
        if (statusOf(err) !== 429 || attempt >= MAX_ATTEMPTS) throw err;
        await sleep(retryDelayMs * attempt);
      }
    }
  }

  return {
    dryRun: flags.dryRun,
    get: (path, query) => call("GET", url(path, query)),
    async list<T>(path: string, query: Record<string, string | number> = {}) {
      const all: T[] = [];
      for (let page = 1; page < 100; page++) {
        let items: T[];
        try {
          items = await call<T[]>("GET", url(path, { per_page: 200, ...query, page }));
        } catch (err) {
          if (statusOf(err) === 404) break;
          throw err;
        }
        all.push(...items);
        if (items.length < 200) break;
      }
      return all;
    },
    write: (method, path, body, dryRunResult) => call(method, url(path), body, dryRunResult),
  };
}
