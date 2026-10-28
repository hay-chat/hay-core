/**
 * Catalog sync (products capability): WooCommerce REST wc/v3 → CanonicalProduct.
 *
 * Pages /products (100 per page, every status), fetches /variations for
 * variable products, and pushes each page to core via productSource.upsert so
 * `recommend_products` can search the store's real catalog. Only published,
 * visible products are "active"; drafts, private, pending and catalogue-hidden
 * products are synced as "draft" so recommendations skip them. After the last
 * page, products the store no longer returns (deleted or trashed) are pruned.
 */
import type {
  CanonicalProduct,
  CanonicalVariant,
  HayProductSourceRuntimeAPI,
  VariantAvailabilityName,
} from "@hay/plugin-sdk";

export interface WooCredentials {
  siteUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

interface WooImage {
  src: string;
  alt?: string;
}

interface WooAttribute {
  name: string;
  position?: number;
  variation?: boolean;
  options?: string[];
  /** Variations carry the chosen value instead of `options`. */
  option?: string;
}

interface WooStockFields {
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  manage_stock?: boolean | "parent";
  stock_quantity?: number | null;
  stock_status?: "instock" | "outofstock" | "onbackorder";
  global_unique_id?: string;
}

export interface WooVariation extends WooStockFields {
  id: number;
  menu_order?: number;
  image?: WooImage | null;
  attributes?: WooAttribute[];
  status?: string;
}

export interface WooProduct extends WooStockFields {
  id: number;
  name: string;
  slug: string;
  permalink?: string;
  type?: string;
  status?: string;
  catalog_visibility?: string;
  description?: string;
  short_description?: string;
  categories?: Array<{ id: number; name: string; slug?: string }>;
  tags?: Array<{ name: string }>;
  brands?: Array<{ name: string }>;
  images?: WooImage[];
  attributes?: WooAttribute[];
  variations?: number[];
}

/** GET a wc/v3 path; returns the JSON body and the X-WP-TotalPages header. */
export type WooGet = <T>(path: string) => Promise<{ data: T; totalPages: number }>;

const PER_PAGE = 100;

function money(value: string | undefined): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function availability(fields: WooStockFields): VariantAvailabilityName {
  if (fields.stock_status === "outofstock") return "out_of_stock";
  if (fields.stock_status === "onbackorder") return "backorder";
  return "in_stock";
}

/** Selling price in `price`; the regular price becomes `compareAtPrice` while on sale. */
function pricing(fields: WooStockFields): Pick<CanonicalVariant, "price" | "compareAtPrice"> {
  const price = money(fields.price) ?? money(fields.regular_price);
  const regular = money(fields.regular_price);
  return {
    price,
    compareAtPrice:
      price !== undefined && regular !== undefined && regular > price ? regular : undefined,
  };
}

function stockFields(fields: WooStockFields, currency: string | undefined) {
  const tracked = fields.manage_stock === true || fields.manage_stock === "parent";
  return {
    sku: fields.sku || undefined,
    barcode: fields.global_unique_id || undefined,
    ...pricing(fields),
    currency,
    inventoryQuantity:
      tracked && typeof fields.stock_quantity === "number" ? fields.stock_quantity : undefined,
    inventoryTracked: tracked,
    availability: availability(fields),
  };
}

function mapVariation(
  variation: WooVariation,
  index: number,
  currency: string | undefined,
): CanonicalVariant {
  const selected = (variation.attributes ?? [])
    .filter((attr) => attr.option)
    .map((attr) => ({ name: attr.name, value: attr.option as string }));
  return {
    externalId: String(variation.id),
    title: selected.length ? selected.map((s) => s.value).join(" / ") : "Default",
    selectedOptions: selected.length ? selected : undefined,
    position: variation.menu_order ?? index + 1,
    imageSrc: variation.image?.src || undefined,
    ...stockFields(variation, currency),
  };
}

export function mapProduct(
  product: WooProduct,
  variations: WooVariation[],
  currency: string | undefined,
): CanonicalProduct {
  const variants = variations
    .filter((v) => v.status === undefined || v.status === "publish")
    .map((v, i) => mapVariation(v, i, currency));
  if (!variants.length) {
    // Simple (and grouped/external) products: the product is its own variant.
    variants.push({
      externalId: `${product.id}::default`,
      title: "Default",
      position: 1,
      imageSrc: product.images?.[0]?.src,
      ...stockFields(product, currency),
    });
  }

  const visible =
    product.status === "publish" &&
    product.catalog_visibility !== "hidden" &&
    product.catalog_visibility !== "search";

  const options = (product.attributes ?? [])
    .filter((attr) => attr.options?.length)
    .map((attr, i) => ({
      name: attr.name,
      position: attr.position ?? i,
      values: attr.options as string[],
    }));

  return {
    externalId: String(product.id),
    // `source` is stamped by core from the authenticated plugin id — not set here.
    handle: product.slug || String(product.id),
    title: product.name,
    descriptionHtml: product.description || undefined,
    descriptionShortHtml: product.short_description || undefined,
    vendor: product.brands?.[0]?.name,
    productType: product.type,
    status: visible ? "active" : "draft",
    tags: (product.tags ?? []).map((t) => t.name),
    categories: product.categories?.length
      ? product.categories.map((c) => ({ externalId: String(c.id), name: c.name, slug: c.slug }))
      : undefined,
    options: options.length ? options : undefined,
    images: (product.images ?? []).map((img, i) => ({
      src: img.src,
      alt: img.alt || undefined,
      position: i,
    })),
    currency,
    sourceUrl: product.permalink || undefined,
    variants,
  };
}

async function listVariations(wooGet: WooGet, productId: number): Promise<WooVariation[]> {
  const out: WooVariation[] = [];
  for (let page = 1; ; page++) {
    const { data, totalPages } = await wooGet<WooVariation[]>(
      `/products/${productId}/variations?per_page=${PER_PAGE}&page=${page}`,
    );
    out.push(...(data ?? []));
    if (!data?.length || page >= totalPages) return out;
  }
}

/** The store currency code, or undefined when the key cannot read it. */
async function storeCurrency(wooGet: WooGet): Promise<string | undefined> {
  try {
    const { data } = await wooGet<{ code?: string }>("/data/currencies/current");
    return data?.code || undefined;
  } catch {
    return undefined;
  }
}

export async function bulkSync(
  wooGet: WooGet,
  productSource: HayProductSourceRuntimeAPI,
  logger: { info: (msg: string, ctx?: Record<string, unknown>) => void },
): Promise<{ total: number; removed: number }> {
  const currency = await storeCurrency(wooGet);
  let total = 0;
  // Every product id the store returned; a page that throws aborts the sync
  // before the prune, so a partial listing never deletes anything.
  const seen: string[] = [];
  for (let page = 1; ; page++) {
    const { data: products, totalPages } = await wooGet<WooProduct[]>(
      `/products?per_page=${PER_PAGE}&page=${page}&status=any&orderby=id&order=asc`,
    );
    if (!products?.length) break;

    const batch: CanonicalProduct[] = [];
    for (const product of products) {
      const variations =
        product.type === "variable" && product.variations?.length
          ? await listVariations(wooGet, product.id)
          : [];
      batch.push(mapProduct(product, variations, currency));
    }
    seen.push(...batch.map((p) => p.externalId));
    const result = await productSource.upsert(batch);
    total += result.upserted;
    if (result.errors > 0) {
      logger.info("WooCommerce catalog batch had errors", { errors: result.errors, page });
    }
    if (page >= totalPages) break;
  }
  const { removed } = await productSource.prune(seen);
  logger.info("WooCommerce catalog sync complete", { total, removed });
  return { total, removed };
}

/** A retrying GET against wc/v3 for the catalog sync (429/5xx/network are replayed). */
export function createWooGet(creds: WooCredentials, timeoutMs = 30_000): WooGet {
  const base = creds.siteUrl.replace(/\/+$/, "");
  return async <T>(path: string) => {
    const url = new URL(`${base}/wp-json/wc/v3${path}`);
    url.searchParams.set("consumer_key", creds.consumerKey);
    url.searchParams.set("consumer_secret", creds.consumerSecret);
    const maxAttempts = 4;
    for (let attempt = 1; ; attempt++) {
      let retryable = false;
      let failure: Error;
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          return {
            data: (await res.json()) as T,
            totalPages: Number(res.headers.get("x-wp-totalpages") || 1),
          };
        }
        retryable = res.status === 429 || res.status >= 500;
        failure = new Error(`WooCommerce GET ${path} failed (HTTP ${res.status})`);
      } catch (err) {
        retryable = true;
        failure = err instanceof Error ? err : new Error(String(err));
      }
      if (!retryable || attempt >= maxAttempts) throw failure;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  };
}
