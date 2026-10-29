/**
 * Seeds the Casa Aurora Europe WooCommerce store (EUR, en) with the demo catalogue, the five EU
 * shoppers and the order fixtures, each in the state its support scenario needs.
 *
 *   tsx scripts/seed-woocommerce.ts [--dry-run] [--only products|customers|orders] [--orders a,b]
 *                                   [--reset-orders] [--image-base-url <url>] [--keep-emails]
 *
 * Env (tools/demo-account/.env): WOO_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET (Read/Write REST
 * key), optional WP_USER + WP_APP_PASSWORD to upload images through wp/v2/media.
 *
 * Idempotent: products match by SKU (variable products by slug, variations by SKU), customers by
 * email, orders by the `_hay_demo_key` meta. Existing records are left alone.
 *
 * WooCommerce REST cannot backdate orders, refunds or notes (date_* are read-only), so the run
 * ends with a `wp eval` command that sets them; tracking meta carries the real ship date anyway.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  daysAgo,
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
import { createWoo, type WooConfig } from "./woocommerce/client";
import {
  carrierFor,
  categoryName,
  CURRENCY,
  customerPayload,
  isShipped,
  isSimple,
  KEY_META,
  orderNotes,
  orderPayload,
  productPayload,
  productTags,
  refundDaysAgo,
  refundPayload,
  trackingUrl,
  variantPrice,
  variationPayload,
  type LineRef,
} from "./woocommerce/mapping";

export const DEFAULT_IMAGE_BASE_URL =
  "https://raw.githubusercontent.com/hay-chat/hay-core/master/tools/demo-account/catalog/images";

/** Customer-facing emails WooCommerce would send while seeding (plus the two admin ones). */
export const EMAIL_SETTINGS = [
  "email_new_order",
  "email_cancelled_order",
  "email_failed_order",
  "email_customer_on_hold_order",
  "email_customer_processing_order",
  "email_customer_completed_order",
  "email_customer_refunded_order",
  "email_customer_note",
  "email_customer_new_account",
];

export interface SeedOptions {
  flags: Flags;
  config: WooConfig;
  now?: Date;
  imageBaseUrl?: string;
  resetOrders?: boolean;
  keepEmails?: boolean;
  /** Injected by tests; default to the JSON files. */
  products?: Product[];
  customers?: Customer[];
  orders?: OrderFixture[];
}

export interface SeedResult {
  rows: SeededOrder[];
  backdateCommand: string | null;
}

interface WooProduct {
  id: number;
  sku?: string;
}
interface WooOrder {
  id: number;
  number: string;
  status: string;
  total: string;
  meta_data?: Array<{ key: string; value: unknown }>;
  line_items?: Array<{ id: number; sku?: string; quantity: number; total: string }>;
}
interface ProductRef {
  productId: number;
  variations: Map<string, number>;
}
interface BackdateRow {
  id: number;
  created: number;
  completed: number | null;
  notes: Array<[number, string]>;
  refunds: Array<[number, number]>;
}

const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const mysqlDate = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

/** One `wp eval` that backdates orders, refunds and notes (run it where WP-CLI reaches the site). */
export function backdateCommand(rows: BackdateRow[]): string | null {
  if (rows.length === 0) return null;
  const data = Buffer.from(JSON.stringify(rows)).toString("base64");
  const php =
    `foreach (json_decode(base64_decode("${data}"), true) as $r) { $o = wc_get_order($r["id"]); if (!$o) continue; ` +
    `$o->set_date_created($r["created"]); if ($o->get_date_paid()) $o->set_date_paid($r["created"] + 300); ` +
    `if ($r["completed"]) $o->set_date_completed($r["completed"]); $o->save(); ` +
    `foreach ($r["refunds"] as $f) { $x = wc_get_order($f[0]); if ($x) { $x->set_date_created($f[1]); $x->save(); } } ` +
    `foreach ($r["notes"] as $n) wp_update_comment(["comment_ID" => $n[0], "comment_date" => $n[1], "comment_date_gmt" => $n[1]]); }`;
  return `wp eval '${php}'`;
}

export async function seedWooCommerce(options: SeedOptions): Promise<SeedResult> {
  const { flags } = options;
  const now = options.now ?? new Date();
  const imageBaseUrl = (options.imageBaseUrl ?? DEFAULT_IMAGE_BASE_URL).replace(/\/+$/, "");
  const products = options.products ?? loadProducts();
  const customers = options.customers ?? loadCustomers("woocommerce");
  const fixtures = (options.orders ?? loadOrders("woocommerce")).filter(
    (o) => flags.orderKeys.size === 0 || flags.orderKeys.has(o.key),
  );
  const woo = createWoo(flags, options.config);
  const step = (name: string) => flags.only.size === 0 || flags.only.has(name);
  let fakeId = 90000;
  const fake = () => ++fakeId;

  // ---------- store settings ----------
  if (flags.only.size === 0) {
    log("Store settings");
    for (const [id, value] of [
      ["woocommerce_currency", CURRENCY],
      ["woocommerce_default_country", "PT"],
    ]) {
      await woo
        .write("PUT", `/settings/general/${id}`, { value }, {})
        .catch((e) => log(`  ! ${id}: ${e.message}`));
    }
    if (!options.keepEmails) {
      for (const group of EMAIL_SETTINGS) {
        await woo
          .write("PUT", `/settings/${group}/enabled`, { value: "no" }, {})
          .catch((e) => log(`  ! ${group}: ${e.message}`));
      }
    }
  }

  // ---------- products ----------
  const categoryIds = new Map<string, number>();
  const tagIds = new Map<string, number>();
  const productRefs = new Map<string, ProductRef>();

  async function termId(
    kind: "categories" | "tags",
    slug: string,
    cache: Map<string, number>,
  ): Promise<number> {
    const cached = cache.get(slug);
    if (cached) return cached;
    let id: number | undefined;
    if (!woo.dryRun) id = (await woo.get<WooProduct[]>(`/products/${kind}`, { slug }))[0]?.id;
    if (!id) {
      const name = kind === "categories" ? categoryName(slug) : slug;
      id = (
        await woo.write<WooProduct>("POST", `/products/${kind}`, { name, slug }, { id: fake() })
      ).id;
    }
    cache.set(slug, id);
    return id;
  }

  async function images(product: Product) {
    const out = [];
    for (const [i, path] of product.images.entries()) {
      const local = join(IMAGES_DIR, path);
      if (woo.canUploadMedia && existsSync(local))
        out.push({ id: await woo.uploadMedia(local, fake()), position: i });
      else out.push({ src: `${imageBaseUrl}/${path}`, name: path, alt: product.title.en });
    }
    return out;
  }

  async function findProduct(product: Product): Promise<WooProduct | undefined> {
    if (woo.dryRun) return undefined;
    const query: Record<string, string> = isSimple(product)
      ? { sku: product.variants[0].sku }
      : { slug: product.handle };
    return (await woo.get<WooProduct[]>("/products", { ...query, status: "any" }))[0];
  }

  async function ensureProduct(product: Product): Promise<ProductRef> {
    const cached = productRefs.get(product.handle);
    if (cached) return cached;
    let found = await findProduct(product);
    if (found) {
      log(`  = ${product.handle} (#${found.id})`);
    } else {
      const refs = {
        categoryId: await termId("categories", product.category, categoryIds),
        tagIds: await Promise.all(productTags(product).map((t) => termId("tags", t, tagIds))),
        images: await images(product),
      };
      try {
        found = await woo.write<WooProduct>("POST", "/products", productPayload(product, refs), {
          id: fake(),
        });
      } catch (err) {
        // Woo sideloads image URLs; if they 404 (not pushed yet), create the product without them.
        if (!/image/i.test(String(err))) throw err;
        log(
          `  ! ${product.handle}: images rejected, creating without them (${String(err).slice(0, 120)})`,
        );
        found = await woo.write<WooProduct>(
          "POST",
          "/products",
          productPayload(product, { ...refs, images: [] }),
          {
            id: fake(),
          },
        );
      }
      log(`  + ${product.handle} (#${found.id})`);
    }
    const ref: ProductRef = { productId: found.id, variations: new Map() };
    if (isSimple(product)) {
      productRefs.set(product.handle, ref);
      return ref;
    }
    if (!woo.dryRun) {
      for (const v of await woo.list<WooProduct>(`/products/${found.id}/variations`))
        if (v.sku) ref.variations.set(v.sku, v.id);
    }
    const missing = product.variants.filter((v) => !ref.variations.has(v.sku));
    if (missing.length) {
      const result = await woo.write<{ create?: WooProduct[] }>(
        "POST",
        `/products/${found.id}/variations/batch`,
        { create: missing.map((v) => variationPayload(product, v)) },
        { create: missing.map((v) => ({ id: fake(), sku: v.sku })) },
      );
      for (const v of result.create ?? []) if (v.sku) ref.variations.set(v.sku, v.id);
    }
    productRefs.set(product.handle, ref);
    return ref;
  }

  if (step("products")) {
    log(`Products (${products.length})`);
    for (const product of products) await ensureProduct(product);
  }

  // ---------- customers ----------
  const customerIds = new Map<string, number>();
  async function ensureCustomer(customer: Customer): Promise<number> {
    const cached = customerIds.get(customer.key);
    if (cached) return cached;
    let id: number | undefined;
    if (!woo.dryRun) {
      id = (await woo.get<WooProduct[]>("/customers", { email: customer.email, role: "all" }))[0]
        ?.id;
      if (id) log(`  = ${customer.email} (#${id})`);
    }
    if (!id) {
      id = (
        await woo.write<WooProduct>("POST", "/customers", customerPayload(customer), { id: fake() })
      ).id;
      log(`  + ${customer.email} (#${id})`);
    }
    customerIds.set(customer.key, id);
    return id;
  }

  if (step("customers")) {
    log(`Customers (${customers.length})`);
    for (const customer of customers) await ensureCustomer(customer);
  }

  // ---------- orders ----------
  const rows: SeededOrder[] = [];
  const backdate: BackdateRow[] = [];
  if (!step("orders")) return { rows, backdateCommand: null };
  log(`Orders (${fixtures.length})`);

  const existing = new Map<string, WooOrder>();
  if (!woo.dryRun) {
    for (const order of await woo.list<WooOrder>("/orders", { status: "any" })) {
      const key = order.meta_data?.find((m) => m.key === KEY_META)?.value;
      if (typeof key === "string") existing.set(key, order);
    }
  }
  if (options.resetOrders) {
    for (const [key, order] of existing) {
      if (flags.orderKeys.size && !flags.orderKeys.has(key)) continue;
      await woo.write("DELETE", `/orders/${order.id}?force=true`, undefined, {});
      log(`  - deleted ${key} (#${order.number})`);
      existing.delete(key);
    }
  }

  // Dry-run with the product/customer steps skipped: placeholders, no lookups or writes printed.
  const skipRefs = woo.dryRun && !step("products");
  const lineRefs = new Map<string, LineRef>();
  for (const fixture of fixtures) {
    if (existing.has(fixture.key)) continue;
    for (const line of fixture.lines) {
      if (lineRefs.has(line.sku)) continue;
      const { product } = productBySku(products, line.sku);
      if (skipRefs) {
        lineRefs.set(
          line.sku,
          isSimple(product) ? { product_id: fake() } : { product_id: fake(), variation_id: fake() },
        );
        continue;
      }
      const ref = await ensureProduct(product);
      const variationId = ref.variations.get(line.sku);
      if (!isSimple(product) && !variationId)
        throw new Error(`Variation ${line.sku} not found in the store`);
      lineRefs.set(
        line.sku,
        isSimple(product)
          ? { product_id: ref.productId }
          : { product_id: ref.productId, variation_id: variationId },
      );
    }
  }

  for (const fixture of fixtures) {
    const customer = customers.find((c) => c.key === fixture.customer.woocommerce);
    if (!customer)
      throw new Error(
        `${fixture.key}: customer ${fixture.customer.woocommerce} is not in customers.json`,
      );
    const shipped = isShipped(fixture);
    const carrier = carrierFor(fixture, customer);
    const tracking = shipped ? trackingNumber(fixture, "woocommerce") : null;
    const row: SeededOrder = {
      key: fixture.key,
      orderId: "",
      orderNumber: "",
      status: "",
      tracking,
      trackingUrl: tracking ? trackingUrl(carrier, tracking) : null,
      result: woo.dryRun ? "dry-run" : "created",
      notes: [],
    };
    const found = existing.get(fixture.key);
    if (found) {
      rows.push({
        ...row,
        orderId: String(found.id),
        orderNumber: String(found.number),
        status: found.status,
        result: "existing",
      });
      log(`  = ${fixture.key} (#${found.number}, ${found.status})`);
      continue;
    }

    const customerId = woo.dryRun && !step("customers") ? fake() : await ensureCustomer(customer);
    const payload = orderPayload(fixture, {
      customer,
      customerId,
      products,
      lineRef: (sku) => lineRefs.get(sku)!,
      now,
    });
    const dryOrder: WooOrder = {
      id: fake(),
      number: "",
      status: String(payload.status),
      total: "0",
      line_items: fixture.lines.map((line) => {
        const { product, variant } = productBySku(products, line.sku);
        return {
          id: fake(),
          sku: line.sku,
          quantity: line.quantity,
          total: (variantPrice(product, variant) * line.quantity).toFixed(2),
        };
      }),
    };
    dryOrder.number = String(dryOrder.id);
    dryOrder.total = dryOrder.line_items!.reduce((s, l) => s + Number(l.total), 0).toFixed(2);
    const order = await woo.write<WooOrder>("POST", "/orders", payload, dryOrder);
    const bd: BackdateRow = {
      id: order.id,
      created: unix(daysAgo(fixture.placedDaysAgo, now)),
      completed:
        fixture.deliveredDaysAgo !== undefined
          ? unix(daysAgo(fixture.deliveredDaysAgo, now))
          : null,
      notes: [],
      refunds: [],
    };

    for (const note of orderNotes(fixture, { customer, now })) {
      const created = await woo.write<{ id: number }>(
        "POST",
        `/orders/${order.id}/notes`,
        { note: note.note, customer_note: note.customer_note },
        { id: fake() },
      );
      bd.notes.push([created.id, mysqlDate(note.date)]);
    }

    let status = order.status;
    const refund = refundPayload(fixture, order);
    if (refund) {
      const created = await woo.write<{ id: number }>(
        "POST",
        `/orders/${order.id}/refunds`,
        refund,
        { id: fake() },
      );
      bd.refunds.push([created.id, unix(daysAgo(refundDaysAgo(fixture), now))]);
      status = woo.dryRun
        ? fixture.financialStatus === "refunded"
          ? "refunded"
          : status
        : (await woo.get<WooOrder>(`/orders/${order.id}`)).status;
    }

    if (fixture.cancelled && fixture.financialStatus === "refunded") {
      row.notes.push(
        'Woo has no "cancelled + refunded": a full refund leaves the order "refunded".',
      );
    }
    if (fixture.fulfillmentStatus === "delivered")
      row.notes.push('Woo has no delivered state: completed + "Delivered on" note.');
    backdate.push(bd);
    rows.push({ ...row, orderId: String(order.id), orderNumber: String(order.number), status });
    log(`  + ${fixture.key} (#${order.number}, ${status})`);
  }

  return { rows, backdateCommand: backdateCommand(backdate) };
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function run(argv: string[]): Promise<number> {
  try {
    loadEnv();
    const flags = parseFlags(argv);
    const config: WooConfig = flags.dryRun
      ? {
          url: process.env.WOO_URL || "http://localhost:8085",
          consumerKey: process.env.WOO_CONSUMER_KEY || "",
          consumerSecret: process.env.WOO_CONSUMER_SECRET || "",
        }
      : (() => {
          const env = requireEnv("WOO_URL", "WOO_CONSUMER_KEY", "WOO_CONSUMER_SECRET");
          return {
            url: env.WOO_URL,
            consumerKey: env.WOO_CONSUMER_KEY,
            consumerSecret: env.WOO_CONSUMER_SECRET,
          };
        })();
    config.wpUser = process.env.WP_USER || undefined;
    config.wpAppPassword = process.env.WP_APP_PASSWORD || undefined;
    log(`WooCommerce ${config.url}${flags.dryRun ? " (dry-run: nothing is sent)" : ""}`);

    const { rows, backdateCommand } = await seedWooCommerce({
      flags,
      config,
      imageBaseUrl: argValue(argv, "--image-base-url"),
      resetOrders: argv.includes("--reset-orders"),
      keepEmails: argv.includes("--keep-emails"),
    });
    if (rows.length) printSeededTable(rows);
    if (!flags.dryRun && rows.length) {
      log(
        `\nWrote ${writeSeededOrders("woocommerce", rows, { store: config.url, backdateCommand })}`,
      );
    }
    if (backdateCommand && !flags.dryRun) {
      log("\nREST cannot set order/refund/note dates. To backdate them, run on the WordPress host");
      log("(local demo: docker compose exec <wordpress> wp --allow-root ...):\n");
      log(backdateCommand);
    }
    return 0;
  } catch (err) {
    console.error(`seed-woocommerce failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
