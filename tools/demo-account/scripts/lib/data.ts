/**
 * Loads the Casa Aurora demo data and the small helpers every seed script shares:
 * flags, env, dates relative to "now", tracking numbers and an HTTP helper with dry-run.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Customer, OrderFixture, Platform, Product } from "./types";

export const ROOT = join(__dirname, "..", "..");
export const IMAGES_DIR = join(ROOT, "catalog", "images");
/** Tag/marker stored on everything the seed scripts create, so re-runs find it. */
export const DEMO_TAG = "hay-demo";

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8")) as T;
}

export function loadProducts(): Product[] {
  return readJson<{ products: Product[] }>("catalog/products.json").products;
}

export function loadCustomers(platform: Platform): Customer[] {
  return readJson<{ customers: Customer[] }>("orders/customers.json").customers.filter(
    (c) => c.platform === platform,
  );
}

export function loadOrders(platform: Platform): OrderFixture[] {
  return readJson<{ orders: OrderFixture[] }>("orders/orders.json").orders.filter((o) =>
    o.platforms.includes(platform),
  );
}

export interface Flags {
  dryRun: boolean;
  /** Limit to "products", "customers" or "orders". Empty = everything. */
  only: Set<string>;
  /** Only these order keys (comma-separated --orders). Empty = all. */
  orderKeys: Set<string>;
}

export function parseFlags(argv = process.argv.slice(2)): Flags {
  const value = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? "") : "";
  };
  const list = (name: string) =>
    new Set(
      value(name)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  return { dryRun: argv.includes("--dry-run"), only: list("--only"), orderKeys: list("--orders") };
}

/** Reads `tools/demo-account/.env` (gitignored) into process.env; real env vars win. */
export function loadEnv(): void {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

export function requireEnv(...names: string[]): Record<string, string> {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(", ")}. Set them in tools/demo-account/.env (see .env.example).`,
    );
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n] as string]));
}

export function daysAgo(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Deterministic per fixture + platform, so re-runs and scenarios see the same number. */
export function trackingNumber(fixture: OrderFixture, platform: Platform): string {
  const digits = parseInt(
    createHash("sha256").update(`${platform}:${fixture.key}`).digest("hex").slice(0, 10),
    16,
  )
    .toString()
    .padStart(12, "0")
    .slice(0, 12);
  const carrier = fixture.carrier?.[platform] ?? "";
  if (carrier === "Correios") return `HA${digits.slice(0, 9)}BR`;
  if (carrier === "USPS") return `9400${digits}${digits.slice(0, 6)}`;
  if (carrier === "UPS") return `1Z999AA1${digits.slice(0, 10)}`;
  return `DEMO${digits}`;
}

export function productBySku(products: Product[], sku: string) {
  for (const product of products) {
    const variant = product.variants.find((v) => v.sku === sku);
    if (variant) return { product, variant };
  }
  throw new Error(`SKU ${sku} is not in catalog/products.json`);
}

export function log(message: string): void {
  console.log(message);
}

/**
 * fetch with JSON in/out. In dry-run, write calls (anything but GET) are printed and return
 * `dryRunResult` instead of being sent; GETs still run so lookups (idempotency) work.
 */
export async function http<T = unknown>(
  flags: Flags,
  method: string,
  url: string,
  options: { headers?: Record<string, string>; body?: unknown; dryRunResult?: T } = {},
): Promise<T> {
  if (flags.dryRun && method !== "GET") {
    log(
      `  [dry-run] ${method} ${url}${options.body ? ` ${JSON.stringify(options.body).slice(0, 300)}` : ""}`,
    );
    return (options.dryRunResult ?? ({} as T)) as T;
  }
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${url} → ${response.status}: ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** One line of a seed run's summary: fixture key → order on the platform. */
export interface SeededOrder {
  key: string;
  orderId: string;
  orderNumber: string;
  /** Platform status as seeded, e.g. "completed" or "open/paid/delivered". */
  status: string;
  tracking: string | null;
  trackingUrl: string | null;
  /** "created", "existing" (left alone) or "dry-run". */
  result: string;
  /** States the platform could not take as-is and what was done instead. */
  notes: string[];
}

/** Prints the summary table every seed script ends with. */
export function printSeededTable(rows: SeededOrder[]): void {
  const cols: Array<[string, (r: SeededOrder) => string]> = [
    ["fixture", (r) => r.key],
    ["order", (r) => r.orderNumber],
    ["status", (r) => r.status],
    ["tracking", (r) => r.tracking ?? "-"],
    ["result", (r) => r.result],
  ];
  const widths = cols.map(([title, get]) =>
    Math.max(title.length, ...rows.map((r) => get(r).length)),
  );
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  log("");
  log(line(cols.map(([title]) => title)));
  log(line(widths.map((w) => "-".repeat(w))));
  for (const row of rows) log(line(cols.map(([, get]) => get(row))));
}

/** Writes orders/seeded-<platform>.json (gitignored) so scenarios can look orders up by key. */
export function writeSeededOrders(
  platform: Platform,
  rows: SeededOrder[],
  extra: Record<string, unknown> = {},
): string {
  const file = join(ROOT, "orders", `seeded-${platform}.json`);
  writeFileSync(
    file,
    `${JSON.stringify({ platform, seededAt: new Date().toISOString(), ...extra, orders: rows }, null, 2)}\n`,
  );
  return file;
}
