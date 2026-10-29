/**
 * Seeds the Casa Aurora Brasil Nuvemshop store (BRL, pt-BR) with the demo catalogue, the five
 * Brazilian shoppers and the order fixtures, each in the state its support scenario needs.
 *
 *   tsx scripts/seed-nuvemshop.ts [--dry-run] [--only products|customers|orders] [--orders a,b]
 *                                 [--reset-orders] [--image-base-url <url>]
 *
 * Env (tools/demo-account/.env): NUVEMSHOP_STORE_ID, NUVEMSHOP_ACCESS_TOKEN, optional
 * NUVEMSHOP_API_VERSION (default 2025-03, same as the plugin).
 *
 * Idempotent: products match by SKU (GET /products/sku/{sku}), customers by email, orders by the
 * `[hay-demo:<key>]` marker in owner_note. Existing records are left alone.
 *
 * Images are uploaded as base64 `attachment` from catalog/images, so nothing needs hosting;
 * a missing local file falls back to `src` under --image-base-url.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMAGES_DIR,
  loadCustomers,
  loadEnv,
  loadOrders,
  loadProducts,
  log,
  parseFlags,
  printSeededTable,
  productBySku,
  requireEnv,
  trackingNumber,
  writeSeededOrders,
  type Flags,
  type SeededOrder,
} from "./lib/data";
import type { Customer, OrderFixture, Product } from "./lib/types";
import {
  createNuvemshop,
  statusOf,
  type Nuvemshop,
  type NuvemshopConfig,
} from "./nuvemshop/client";
import {
  cancelPayload,
  carrierFor,
  categoryPayload,
  customerPayload,
  finalOrderStatus,
  fulfilmentSteps,
  isShipped,
  legacyFulfilPayload,
  MARKER_RE,
  orderPayload,
  paymentStatusCandidates,
  productPayload,
  trackingUrl,
  variantPayload,
  type StoreLanguage,
} from "./nuvemshop/mapping";
import { DEFAULT_IMAGE_BASE_URL } from "./seed-woocommerce";

export interface SeedOptions {
  flags: Flags;
  config: NuvemshopConfig;
  now?: Date;
  imageBaseUrl?: string;
  resetOrders?: boolean;
  retryDelayMs?: number;
  products?: Product[];
  customers?: Customer[];
  orders?: OrderFixture[];
}

interface NsVariant {
  id: number;
  sku?: string | null;
}
interface NsProduct {
  id: number;
  variants?: NsVariant[];
}
interface NsOrder {
  id: number;
  number: number | string;
  status?: string;
  payment_status?: string;
  shipping_status?: string;
  owner_note?: string | null;
}

export async function seedNuvemshop(options: SeedOptions): Promise<SeededOrder[]> {
  const { flags } = options;
  const now = options.now ?? new Date();
  const imageBaseUrl = (options.imageBaseUrl ?? DEFAULT_IMAGE_BASE_URL).replace(/\/+$/, "");
  const products = options.products ?? loadProducts();
  const customers = options.customers ?? loadCustomers("nuvemshop");
  const fixtures = (options.orders ?? loadOrders("nuvemshop")).filter(
    (o) => flags.orderKeys.size === 0 || flags.orderKeys.has(o.key),
  );
  const ns: Nuvemshop = createNuvemshop(flags, options.config, {
    retryDelayMs: options.retryDelayMs,
  });
  const step = (name: string) => flags.only.size === 0 || flags.only.has(name);
  let fakeId = 70000;
  const fake = () => ++fakeId;

  // Fill "en" too when the store has it; dry-run assumes a pt-only store (the BR default).
  let languages: StoreLanguage[] = ["pt"];
  if (!ns.dryRun && step("products")) {
    const store = await ns.get<{ languages?: Record<string, unknown>; main_language?: string }>(
      "/store",
    );
    const codes = Object.keys(store.languages ?? {});
    languages = (["pt", "en"] as StoreLanguage[]).filter((l) => codes.includes(l) || l === "pt");
  }

  // ---------- products ----------
  const variantIds = new Map<string, number>();
  let categories: Array<{ id: number; handle?: Record<string, string> }> | null = null;

  async function categoryId(slug: string): Promise<number> {
    if (!categories) categories = ns.dryRun ? [] : await ns.list("/categories");
    const found = categories.find((c) => Object.values(c.handle ?? {}).includes(slug));
    if (found) return found.id;
    const created = await ns.write<{ id: number; handle?: Record<string, string> }>(
      "POST",
      "/categories",
      categoryPayload(slug, languages),
      { id: fake(), handle: { pt: slug } },
    );
    categories.push(created);
    return created.id;
  }

  async function findBySku(sku: string): Promise<NsProduct | undefined> {
    if (ns.dryRun) return undefined;
    try {
      return await ns.get<NsProduct>(`/products/sku/${encodeURIComponent(sku)}`);
    } catch (err) {
      if (statusOf(err) === 404) return undefined;
      throw err;
    }
  }

  async function uploadImages(product: Product, productId: number) {
    for (const [i, path] of product.images.entries()) {
      const local = join(IMAGES_DIR, path);
      const body = existsSync(local)
        ? { attachment: readFileSync(local).toString("base64"), filename: path, position: i + 1 }
        : { src: `${imageBaseUrl}/${path}`, position: i + 1 };
      if (!("attachment" in body)) log(`  ! ${path} not in catalog/images; using ${body.src}`);
      await ns
        .write("POST", `/products/${productId}/images`, body, {})
        .catch((e) => log(`  ! image ${path}: ${e.message}`));
    }
  }

  async function ensureProduct(product: Product): Promise<void> {
    if (product.variants.every((v) => variantIds.has(v.sku))) return;
    let found: NsProduct | undefined;
    for (const variant of product.variants) {
      found = await findBySku(variant.sku);
      if (found) break;
    }
    if (found) {
      log(`  = ${product.handle} (#${found.id})`);
      for (const v of found.variants ?? []) if (v.sku) variantIds.set(v.sku, v.id);
      for (const variant of product.variants.filter((v) => !variantIds.has(v.sku))) {
        const created = await ns.write<NsVariant>(
          "POST",
          `/products/${found.id}/variants`,
          variantPayload(product, variant, languages),
          { id: fake(), sku: variant.sku },
        );
        variantIds.set(variant.sku, created.id);
      }
      return;
    }
    const created = await ns.write<NsProduct>(
      "POST",
      "/products",
      productPayload(product, await categoryId(product.category), languages),
      { id: fake(), variants: product.variants.map((v) => ({ id: fake(), sku: v.sku })) },
    );
    for (const v of created.variants ?? []) if (v.sku) variantIds.set(v.sku, v.id);
    await uploadImages(product, created.id);
    log(`  + ${product.handle} (#${created.id})`);
  }

  if (step("products")) {
    log(`Products (${products.length}, languages ${languages.join("+")})`);
    for (const product of products) await ensureProduct(product);
  }

  // ---------- customers ----------
  async function ensureCustomer(customer: Customer): Promise<void> {
    if (!ns.dryRun) {
      const hits = await ns.get<Array<{ id: number; email?: string }>>("/customers", {
        q: customer.email,
      });
      const hit = hits.find((c) => c.email?.toLowerCase() === customer.email.toLowerCase());
      if (hit) {
        log(`  = ${customer.email} (#${hit.id})`);
        return;
      }
    }
    const created = await ns.write<{ id: number }>(
      "POST",
      "/customers",
      customerPayload(customer),
      { id: fake() },
    );
    log(`  + ${customer.email} (#${created.id})`);
  }

  if (step("customers")) {
    log(`Customers (${customers.length})`);
    for (const customer of customers) await ensureCustomer(customer);
  }

  // ---------- orders ----------
  const rows: SeededOrder[] = [];
  if (!step("orders")) return rows;
  log(`Orders (${fixtures.length})`);

  const existing = new Map<string, NsOrder>();
  if (!ns.dryRun) {
    for (const order of await ns.list<NsOrder>("/orders", { status: "any" })) {
      const key = MARKER_RE.exec(order.owner_note ?? "")?.[1];
      if (key) existing.set(key, order);
    }
  }
  if (options.resetOrders) {
    for (const [key, order] of existing) {
      if (flags.orderKeys.size && !flags.orderKeys.has(key)) continue;
      try {
        await ns.write("DELETE", `/orders/${order.id}`, undefined, {});
        log(`  - deleted ${key} (#${order.number})`);
      } catch (err) {
        // No order delete for this token/API: cancel it and retire the marker so it is not matched again.
        if (order.status !== "cancelled")
          await ns.write(
            "POST",
            `/orders/${order.id}/cancel`,
            { reason: "other", email: false, restock: true },
            {},
          );
        const note = (order.owner_note ?? "").replace(MARKER_RE, `[hay-demo-reset:${key}]`);
        await ns.write("PUT", `/orders/${order.id}`, { owner_note: note }, {});
        log(
          `  - retired ${key} (#${order.number}): delete refused (${statusOf(err) ?? "error"}), cancelled + marker removed`,
        );
      }
      existing.delete(key);
    }
  }

  for (const fixture of fixtures) {
    const tracking = isShipped(fixture) ? trackingNumber(fixture, "nuvemshop") : null;
    const row: SeededOrder = {
      key: fixture.key,
      orderId: "",
      orderNumber: "",
      status: "",
      tracking,
      trackingUrl: tracking ? trackingUrl(carrierFor(fixture), tracking) : null,
      result: ns.dryRun ? "dry-run" : "created",
      notes: [],
    };
    const found = existing.get(fixture.key);
    if (found) {
      const status = [found.status, found.payment_status, found.shipping_status]
        .filter(Boolean)
        .join("/");
      rows.push({
        ...row,
        orderId: String(found.id),
        orderNumber: String(found.number),
        status,
        result: "existing",
      });
      log(`  = ${fixture.key} (#${found.number}, ${status})`);
      continue;
    }

    const customer = customers.find((c) => c.key === fixture.customer.nuvemshop);
    if (!customer)
      throw new Error(
        `${fixture.key}: customer ${fixture.customer.nuvemshop} is not in customers.json`,
      );
    for (const line of fixture.lines) {
      if (variantIds.has(line.sku)) continue;
      if (ns.dryRun && !step("products")) variantIds.set(line.sku, fake());
      else await ensureProduct(productBySku(products, line.sku).product);
    }
    const ctx = {
      customer,
      products,
      now,
      variantId: (sku: string) => {
        const id = variantIds.get(sku);
        if (!id) throw new Error(`Variant ${sku} not found in the store`);
        return id;
      },
    };

    // Create with the most faithful payment_status the API accepts.
    let order: NsOrder | undefined;
    let paymentStatus = "";
    const candidates = paymentStatusCandidates(fixture);
    for (const [i, candidate] of candidates.entries()) {
      try {
        order = await ns.write<NsOrder>("POST", "/orders", orderPayload(fixture, ctx, candidate), {
          id: fake(),
          number: 0,
          payment_status: candidate,
        });
        paymentStatus = candidate;
        break;
      } catch (err) {
        const status = statusOf(err);
        if (i === candidates.length - 1 || status === null || status >= 500 || status === 401)
          throw err;
        row.notes.push(
          `payment_status "${candidate}" refused on create (${status}); created as "${candidates[i + 1]}", refund noted in owner_note.`,
        );
      }
    }
    if (!order) throw new Error(`${fixture.key}: order was not created`);
    if (ns.dryRun) order.number = order.id;

    // Shipping: fulfillment orders (what the plugin reads first), else the legacy fulfil endpoint.
    const steps = fulfilmentSteps(fixture, now);
    if (steps.length) {
      let fos: Array<{ id: string }> | null = ns.dryRun ? [{ id: "<fulfillment-order-id>" }] : null;
      if (!ns.dryRun) {
        fos = await ns
          .get<Array<{ id: string }>>(`/orders/${order.id}/fulfillment-orders`)
          .catch(() => null);
      }
      let legacy = !fos || fos.length === 0;
      if (!legacy) {
        try {
          for (const fo of fos!) {
            for (const s of steps) {
              await ns.write(
                s.method,
                `/orders/${order.id}/fulfillment-orders/${encodeURIComponent(fo.id)}${s.path}`,
                s.body,
                {},
              );
            }
          }
        } catch (err) {
          row.notes.push(
            `fulfillment-order update failed (${statusOf(err) ?? "error"}); used legacy /fulfill, no carrier events or delivery date.`,
          );
          legacy = true;
        }
      }
      if (legacy)
        await ns.write("POST", `/orders/${order.id}/fulfill`, legacyFulfilPayload(fixture), {});
    }

    const finalStatus = finalOrderStatus(fixture);
    if (finalStatus === "closed") await ns.write("POST", `/orders/${order.id}/close`, {}, {});
    if (finalStatus === "cancelled")
      await ns.write("POST", `/orders/${order.id}/cancel`, cancelPayload(fixture), {});

    const shipping = {
      unfulfilled: "unpacked",
      in_transit: "dispatched",
      stale: "dispatched",
      delivered: "delivered",
    }[fixture.fulfillmentStatus];
    const status = `${finalStatus}/${paymentStatus}/${shipping}`;
    rows.push({ ...row, orderId: String(order.id), orderNumber: String(order.number), status });
    log(`  + ${fixture.key} (#${order.number}, ${status})`);
  }
  return rows;
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function run(argv: string[]): Promise<number> {
  try {
    loadEnv();
    const flags = parseFlags(argv);
    const config: NuvemshopConfig = flags.dryRun
      ? {
          storeId: process.env.NUVEMSHOP_STORE_ID || "",
          accessToken: process.env.NUVEMSHOP_ACCESS_TOKEN || "",
        }
      : (() => {
          const env = requireEnv("NUVEMSHOP_STORE_ID", "NUVEMSHOP_ACCESS_TOKEN");
          return { storeId: env.NUVEMSHOP_STORE_ID, accessToken: env.NUVEMSHOP_ACCESS_TOKEN };
        })();
    config.apiVersion = process.env.NUVEMSHOP_API_VERSION || undefined;
    log(
      `Nuvemshop store ${config.storeId || "<store_id>"}${flags.dryRun ? " (dry-run: nothing is sent)" : ""}`,
    );

    const rows = await seedNuvemshop({
      flags,
      config,
      imageBaseUrl: argValue(argv, "--image-base-url"),
      resetOrders: argv.includes("--reset-orders"),
    });
    if (rows.length) printSeededTable(rows);
    if (!flags.dryRun && rows.length) {
      log(`\nWrote ${writeSeededOrders("nuvemshop", rows, { store: config.storeId })}`);
    }
    return 0;
  } catch (err) {
    console.error(`seed-nuvemshop failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
