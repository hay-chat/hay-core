/**
 * Small WooCommerce REST client for the seed script, on top of lib/data.ts `http`.
 * Auth: HTTP Basic over https; consumer_key/consumer_secret in the query string over plain http
 * (WooCommerce refuses Basic there, e.g. the local demo at http://localhost:8085).
 * Dry-run never sends anything (no GETs either), so it works without credentials.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { http, log, type Flags } from "../lib/data";

export interface Woo {
  dryRun: boolean;
  get<T>(path: string, query?: Record<string, string | number>): Promise<T>;
  /** Every page of a list endpoint (100 per page). */
  list<T>(path: string, query?: Record<string, string | number>): Promise<T[]>;
  write<T>(method: "POST" | "PUT" | "DELETE", path: string, body: unknown, dryRunResult: T, namespace?: string): Promise<T>;
  /** Uploads a local image to wp/v2/media (needs WP_USER + WP_APP_PASSWORD); returns its id. */
  uploadMedia(file: string, dryRunId: number): Promise<number>;
  canUploadMedia: boolean;
}

export interface WooConfig {
  url: string;
  consumerKey: string;
  consumerSecret: string;
  wpUser?: string;
  wpAppPassword?: string;
}

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

export function createWoo(flags: Flags, config: WooConfig): Woo {
  const site = config.url.replace(/\/+$/, "");
  const https = site.startsWith("https://");
  const secrets = [config.consumerKey, config.consumerSecret, config.wpAppPassword].filter(Boolean) as string[];

  // Never let a key reach the console (http errors quote the URL).
  const redact = (text: string) => secrets.reduce((t, s) => t.split(encodeURIComponent(s)).join("***").split(s).join("***"), text);

  function url(path: string, query: Record<string, string | number> = {}, namespace = "wc/v3"): string {
    const u = new URL(`${site}/wp-json/${namespace}${path}`);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
    if (!https && !flags.dryRun) {
      u.searchParams.set("consumer_key", config.consumerKey);
      u.searchParams.set("consumer_secret", config.consumerSecret);
    }
    return u.toString();
  }

  const headers = (): Record<string, string> =>
    https ? { Authorization: basic(config.consumerKey, config.consumerSecret) } : {};

  async function call<T>(method: string, target: string, body?: unknown, dryRunResult?: T): Promise<T> {
    try {
      return await http<T>(flags, method, target, { headers: headers(), body, dryRunResult });
    } catch (err) {
      throw new Error(redact(err instanceof Error ? err.message : String(err)));
    }
  }

  return {
    dryRun: flags.dryRun,
    canUploadMedia: Boolean(config.wpUser && config.wpAppPassword),
    get: (path, query) => call("GET", url(path, query)),
    async list<T>(path: string, query: Record<string, string | number> = {}) {
      const all: T[] = [];
      for (let page = 1; page < 100; page++) {
        const items = await call<T[]>("GET", url(path, { per_page: 100, ...query, page }));
        all.push(...items);
        if (items.length < 100) break;
      }
      return all;
    },
    write: (method, path, body, dryRunResult, namespace) =>
      call(method, url(path, {}, namespace), body, dryRunResult),
    async uploadMedia(file: string, dryRunId: number) {
      const target = `${site}/wp-json/wp/v2/media`;
      if (flags.dryRun) {
        log(`  [dry-run] POST ${target} (upload ${basename(file)})`);
        return dryRunId;
      }
      // Application passwords need https (or WP_ENVIRONMENT_TYPE=local on plain http).
      const response = await fetch(target, {
        method: "POST",
        headers: {
          Authorization: basic(config.wpUser ?? "", config.wpAppPassword ?? ""),
          "Content-Type": file.endsWith(".png") ? "image/png" : "image/jpeg",
          "Content-Disposition": `attachment; filename="${basename(file)}"`,
        },
        body: readFileSync(file),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(redact(`POST ${target} → ${response.status}: ${text.slice(0, 300)}`));
      return (JSON.parse(text) as { id: number }).id;
    },
  };
}
