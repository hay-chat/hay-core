/**
 * Seeds a Shopify development store with the Casa Aurora catalogue, customers and order states.
 *
 *   tsx tools/demo-account/scripts/seed-shopify.ts [--dry-run] [--only products|customers|orders]
 *     [--orders key1,key2] [--reset-orders] [--image-base-url <url>]
 *
 * Env (tools/demo-account/.env): SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN. Dry-run needs neither.
 * Idempotent: products match by handle/SKU, customers by email, orders by tag `hay-demo:<key>`.
 * Writes the result to orders/seeded-shopify.json (not in dry-run).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  loadCustomers,
  loadEnv,
  loadOrders,
  loadProducts,
  log,
  parseFlags,
  requireEnv,
} from "./lib/data";
import type { Customer, OrderFixture, Product } from "./lib/types";
import { API_VERSION, createShopify, type Shopify } from "./shopify/client";
import { findCustomerIds, seedCustomers } from "./shopify/customers";
import { resetOrders, seedOrder, type SeededOrder } from "./shopify/orders";
import { findVariantIds, seedProducts } from "./shopify/products";

export const SUMMARY_FILE = join(ROOT, "orders", "seeded-shopify.json");

export interface SeedOptions {
  only: Set<string>;
  orderKeys: Set<string>;
  resetOrders: boolean;
  imageBaseUrl?: string;
  now?: Date;
  pollMs?: number;
}

export interface SeedData {
  products: Product[];
  customers: Customer[];
  orders: OrderFixture[];
}

/** Runs the selected steps against `shop`; returns the order rows for the summary. */
export async function seedShopify(
  shop: Shopify,
  data: SeedData,
  options: SeedOptions,
): Promise<SeededOrder[]> {
  const wants = (step: string) => options.only.size === 0 || options.only.has(step);
  const orders = data.orders.filter(
    (o) => options.orderKeys.size === 0 || options.orderKeys.has(o.key),
  );
  const unknown = [...options.orderKeys].filter((key) => !data.orders.some((o) => o.key === key));
  if (unknown.length > 0) throw new Error(`Unknown order keys: ${unknown.join(", ")}`);

  let variantIds: Record<string, string> = {};
  let customerIds: Record<string, string> = {};
  if (wants("products"))
    variantIds = await seedProducts(shop, data.products, { imageBaseUrl: options.imageBaseUrl });
  if (wants("customers")) customerIds = await seedCustomers(shop, data.customers);
  if (!wants("orders")) return [];

  // --only orders: resolve what the earlier steps would have returned.
  if (!wants("products"))
    variantIds = await findVariantIds(
      shop,
      orders.flatMap((o) => o.lines.map((l) => l.sku)),
    );
  if (!wants("customers")) {
    const used = new Set(orders.map((o) => o.customer.shopify));
    customerIds = await findCustomerIds(
      shop,
      data.customers.filter((c) => used.has(c.key)),
    );
  }
  if (options.resetOrders) await resetOrders(shop, options.orderKeys);

  const ctx = {
    products: data.products,
    customers: Object.fromEntries(data.customers.map((c) => [c.key, c])),
    customerIds,
    variantIds,
    now: options.now ?? new Date(),
  };
  const seeded: SeededOrder[] = [];
  for (const fixture of orders)
    seeded.push(await seedOrder(shop, fixture, ctx, { pollMs: options.pollMs }));
  return seeded;
}

export function summaryTable(rows: SeededOrder[]): string {
  const header = ["fixture", "order", "status", "financial", "fulfillment", "shipment", "tracking"];
  const body = rows.map((r) => [
    r.key,
    r.orderName ?? "-",
    r.status,
    r.financialStatus + (r.cancelled ? " (cancelled)" : ""),
    r.fulfillmentStatus,
    r.shipmentStatus ?? "-",
    r.tracking ?? "-",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function run(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    loadEnv();
    const env = flags.dryRun
      ? {
          SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN || "dry-run.myshopify.com",
          SHOPIFY_ADMIN_TOKEN: "",
        }
      : requireEnv("SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_TOKEN");
    const domain = env.SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
    log(
      `Shopify ${domain} (Admin API ${API_VERSION})${flags.dryRun ? " — dry run, nothing is sent" : ""}`,
    );

    const shop = createShopify(flags, domain, env.SHOPIFY_ADMIN_TOKEN);
    const rows = await seedShopify(
      shop,
      {
        products: loadProducts(),
        customers: loadCustomers("shopify"),
        orders: loadOrders("shopify"),
      },
      {
        only: flags.only,
        orderKeys: flags.orderKeys,
        resetOrders: argv.includes("--reset-orders"),
        imageBaseUrl: argValue(argv, "--image-base-url"),
      },
    );
    if (rows.length > 0) {
      log(`\n${summaryTable(rows)}`);
      if (!flags.dryRun) {
        writeFileSync(
          SUMMARY_FILE,
          `${JSON.stringify({ store: domain, seededAt: new Date().toISOString(), orders: rows }, null, 2)}\n`,
        );
        log(`\nWrote ${SUMMARY_FILE}`);
      }
    }
    return 0;
  } catch (error) {
    console.error(`seed-shopify failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (require.main === module) {
  void run(process.argv.slice(2)).then((code) => process.exit(code));
}
