/**
 * Nuvemshop / Tiendanube Plugin — LatAm e-commerce integration + catalog sync.
 *
 * Nuvemshop (Brazil) and Tiendanube (Spanish-speaking LatAm) are the same
 * platform and the same API; only the domains differ. Connection uses a
 * store-scoped "custom app" access token (admin → Aplicativos a medida /
 * Aplicaciones a medida): the merchant pastes the token + store ID here.
 * Those tokens never expire (they are invalidated only by re-issuing or
 * uninstalling), so there is no refresh cron.
 *
 * TODO: add a managed OAuth mode via a Hay partner app. Tiendanube's OAuth is
 * nonstandard (authorize URL is https://www.tiendanube.com/apps/{app_id}/authorize
 * with no scope param — scopes are fixed at app registration), so core's oauth2
 * flow needs an {app_id} URL substitution before that can land.
 *
 * The MCP server (./mcp) only ever sees NUVEMSHOP_STORE_ID +
 * NUVEMSHOP_ACCESS_TOKEN + NUVEMSHOP_API_VERSION + NUVEMSHOP_MAIN_LANGUAGE.
 *
 * When the `products` capability is enabled, `onStart` also runs a background
 * bulk catalog sync — paging REST /products and pushing CanonicalProduct
 * batches to core via `ctx.productSource.upsert(...)`.
 *
 * @see https://tiendanube.github.io/api-documentation/authentication
 */

import { defineHayPlugin } from "@hay/plugin-sdk";
import type {
  CanonicalProduct,
  CanonicalVariant,
  HayProductSourceRuntimeAPI,
} from "@hay/plugin-sdk";

// api.tiendanube.com and api.nuvemshop.com.br are interchangeable twins; either
// host serves any store regardless of country.
const API_HOST = "https://api.nuvemshop.com.br";
const DEFAULT_API_VERSION = "2025-03";
// Mandatory on every request — Nuvemshop returns 400 without it.
const USER_AGENT = "Hay (https://hay.chat)";

/** A Nuvemshop i18n field: {"es": "...", "pt": "...", "en": "..."} or a plain string. */
type I18nField = string | Record<string, string> | null | undefined;

/** Pick one language from an i18n object field (falls back through common languages). */
function pickLang(field: I18nField, lang: string): string | undefined {
  if (field === null || field === undefined) return undefined;
  if (typeof field === "string") return field;
  const candidates = [lang, "pt", "es", "en", ...Object.keys(field)];
  for (const key of candidates) {
    const value = field[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

interface NuvemshopCredentials {
  storeId: string;
  accessToken: string;
}

function readCredentials(ctx: {
  config: { getOptional: <T = unknown>(key: string) => T | undefined };
}): NuvemshopCredentials | null {
  const storeId = ctx.config.getOptional<string>("storeId")?.trim();
  const accessToken = ctx.config.getOptional<string>("accessToken")?.trim();
  if (!storeId || !accessToken) return null;
  return { storeId, accessToken };
}

/**
 * Minimal REST helper for the entry (validation + catalog sync). The MCP server
 * has its own richer client with retries; here failures surface to the caller.
 * Note the nonstandard auth header: `Authentication: bearer <token>` (lowercase
 * "bearer") — the standard `Authorization` header is rejected with a 401.
 */
class NuvemshopHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** X-Rate-Limit-Reset (milliseconds until the leaky bucket drains), when sent. */
    readonly rateLimitResetMs?: number,
  ) {
    super(message);
  }
}

async function nuvemshopFetch<T>(
  creds: NuvemshopCredentials,
  apiVersion: string,
  path: string,
): Promise<T> {
  const url = `${API_HOST}/${apiVersion}/${creds.storeId}${path}`;
  const res = await fetch(url, {
    headers: {
      Authentication: `bearer ${creds.accessToken}`,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const reset = Number(res.headers.get("x-rate-limit-reset"));
    throw new NuvemshopHttpError(
      `Nuvemshop GET ${path} failed (HTTP ${res.status}): ${text.slice(0, 200)}`,
      res.status,
      Number.isFinite(reset) && reset > 0 ? reset : undefined,
    );
  }
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retrying GET for the catalog sync: the leaky bucket (~2 req/s, burst 40) is
 * shared with live MCP tool traffic on the same token, so 429s mid-sync are
 * routine — without retries one throttle would abort the sync and leave a
 * silently partial catalog. GETs are safe to replay.
 */
async function nuvemshopFetchWithRetry<T>(
  creds: NuvemshopCredentials,
  apiVersion: string,
  path: string,
): Promise<T> {
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await nuvemshopFetch<T>(creds, apiVersion, path);
    } catch (error) {
      const retryable =
        error instanceof NuvemshopHttpError && (error.status === 429 || error.status >= 500);
      if (!retryable || attempt >= maxAttempts) throw error;
      const wait =
        error.status === 429 && error.rateLimitResetMs !== undefined
          ? Math.min(error.rateLimitResetMs, 20_000)
          : attempt * 1_000;
      await sleep(wait);
    }
  }
}

interface NuvemshopStore {
  id: number;
  name?: Record<string, string>;
  main_language?: string;
  main_currency?: string;
  url_with_protocol?: string;
}

// ============================================================================
// Catalog sync (products capability) — REST /products → CanonicalProduct
// ============================================================================

interface NuvemshopInventoryLevel {
  location_id?: string;
  stock: number | null;
}

interface NuvemshopVariant {
  id: number;
  image_id?: number | null;
  price?: string | null;
  promotional_price?: string | null;
  stock_management?: boolean;
  /** Legacy (v1) per-variant stock; null = unlimited. */
  stock?: number | null;
  /** 2025-03 multi-inventory replacement for `stock`. */
  inventory_levels?: NuvemshopInventoryLevel[];
  sku?: string | null;
  barcode?: string | null;
  values?: I18nField[];
  weight?: string | null;
  position?: number;
}

interface NuvemshopImage {
  id: number;
  src: string;
  position?: number;
  alt?: I18nField;
}

interface NuvemshopCategoryRef {
  id: number;
  name?: I18nField;
  handle?: I18nField;
}

interface NuvemshopProduct {
  id: number;
  name: I18nField;
  description?: I18nField;
  handle?: I18nField;
  attributes?: I18nField[];
  published?: boolean;
  brand?: string | null;
  tags?: string | null;
  canonical_url?: string | null;
  /** Docs say "category ids" but real payloads embed full objects — tolerate both. */
  categories?: Array<NuvemshopCategoryRef | number>;
  images?: NuvemshopImage[];
  variants?: NuvemshopVariant[];
}

/** Total stock across inventory levels; null/undefined stock means untracked/unlimited. */
function variantStock(variant: NuvemshopVariant): number | undefined {
  if (variant.stock !== undefined && variant.stock !== null) return variant.stock;
  if (Array.isArray(variant.inventory_levels) && variant.inventory_levels.length > 0) {
    let total = 0;
    for (const level of variant.inventory_levels) {
      if (level.stock === null) return undefined; // any unlimited location → unlimited
      total += level.stock;
    }
    return total;
  }
  return undefined;
}

function mapVariant(
  product: NuvemshopProduct,
  variant: NuvemshopVariant,
  index: number,
  lang: string,
  currency: string | undefined,
): CanonicalVariant {
  const optionNames = (product.attributes ?? []).map(
    (attr, i) => pickLang(attr, lang) ?? `Option ${i + 1}`,
  );
  const values = (variant.values ?? [])
    .map((value) => pickLang(value, lang))
    .filter((value): value is string => Boolean(value));
  const title = values.length ? values.join(" / ") : "Default";

  // Nuvemshop semantics: `price` is the regular price, `promotional_price` the
  // active sale price. Canonically the selling price goes in `price` and the
  // regular price becomes `compareAtPrice` (Shopify-style).
  const regular = variant.price ? parseFloat(variant.price) : undefined;
  const promotional = variant.promotional_price ? parseFloat(variant.promotional_price) : undefined;

  const stock = variantStock(variant);
  const tracked = variant.stock_management === true;

  const image = variant.image_id
    ? product.images?.find((img) => img.id === variant.image_id)
    : undefined;

  return {
    externalId: String(variant.id),
    sku: variant.sku ?? undefined,
    barcode: variant.barcode ?? undefined,
    title,
    selectedOptions: values.length
      ? values.map((value, i) => ({ name: optionNames[i] ?? `Option ${i + 1}`, value }))
      : undefined,
    position: variant.position ?? index + 1,
    price: promotional ?? regular,
    compareAtPrice: promotional !== undefined ? regular : undefined,
    currency,
    inventoryQuantity: stock,
    inventoryTracked: tracked,
    availability: tracked && stock !== undefined && stock <= 0 ? "out_of_stock" : "in_stock",
    weightValue: variant.weight ? parseFloat(variant.weight) : undefined,
    weightUnit: variant.weight ? "kg" : undefined,
    imageSrc: image?.src,
  };
}

function mapProduct(
  product: NuvemshopProduct,
  lang: string,
  currency: string | undefined,
): CanonicalProduct {
  const variants = (product.variants ?? []).map((variant, i) =>
    mapVariant(product, variant, i, lang, currency),
  );
  if (!variants.length) {
    // Defensive — core's "variants required" contract must hold.
    variants.push({ externalId: `${product.id}::default`, title: "Default" });
  }

  const categories = (product.categories ?? [])
    .filter((category): category is NuvemshopCategoryRef => typeof category === "object")
    .map((category) => ({
      externalId: String(category.id),
      name: pickLang(category.name, lang) ?? String(category.id),
      slug: pickLang(category.handle, lang),
    }));

  const optionNames = (product.attributes ?? []).map(
    (attr, i) => pickLang(attr, lang) ?? `Option ${i + 1}`,
  );
  const options = optionNames.map((name, i) => ({
    name,
    position: i + 1,
    values: [
      ...new Set(
        (product.variants ?? [])
          .map((variant) => pickLang(variant.values?.[i], lang))
          .filter((value): value is string => Boolean(value)),
      ),
    ],
  }));

  return {
    externalId: String(product.id),
    // `source` is stamped by core from the authenticated plugin id — not set here.
    handle: pickLang(product.handle, lang) ?? String(product.id),
    title: pickLang(product.name, lang) ?? String(product.id),
    descriptionHtml: pickLang(product.description, lang),
    vendor: product.brand ?? undefined,
    status: product.published === false ? "draft" : "active",
    tags: product.tags
      ? product.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [],
    categories: categories.length ? categories : undefined,
    options: options.length ? options : undefined,
    images: (product.images ?? []).map((img, i) => ({
      src: img.src,
      alt: pickLang(img.alt, lang),
      position: img.position ?? i,
    })),
    currency,
    sourceUrl: product.canonical_url ?? undefined,
    variants,
  };
}

async function bulkSync(
  creds: NuvemshopCredentials,
  apiVersion: string,
  lang: string,
  currency: string | undefined,
  productSource: HayProductSourceRuntimeAPI,
  logger: {
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    error: (msg: string, ctx?: unknown) => void;
  },
): Promise<void> {
  const perPage = 200; // API max
  let page = 1;
  let total = 0;

  for (;;) {
    let batch: NuvemshopProduct[];
    try {
      batch = await nuvemshopFetchWithRetry<NuvemshopProduct[]>(
        creds,
        apiVersion,
        `/products?per_page=${perPage}&page=${page}`,
      );
    } catch (error) {
      // Past the last page Nuvemshop 404s ("Last page is N") instead of
      // returning an empty array — treat that as end-of-catalog.
      if (page > 1 && error instanceof NuvemshopHttpError && error.status === 404) break;
      throw error;
    }
    if (!batch.length) break;

    const products = batch.map((product) => mapProduct(product, lang, currency));
    const result = await productSource.upsert(products);
    total += result.upserted;
    if (result.errors > 0) {
      logger.info("Nuvemshop batch had errors", { errors: result.errors, page });
    }

    if (batch.length < perPage) break;
    page += 1;
  }

  logger.info("Nuvemshop bulk sync complete", { total });
}

export default defineHayPlugin((globalCtx) => ({
  name: "Nuvemshop",

  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Nuvemshop plugin");

    ctx.register.config({
      storeId: {
        type: "string",
        label: "Store ID",
        description:
          "Your numeric store ID. Shown when creating the custom app; it is the " +
          "user_id of your store.",
        placeholder: "123456",
        required: true,
      },
      accessToken: {
        type: "string",
        label: "Access token",
        description:
          "Access token from a custom app (admin → Aplicativos a medida / " +
          "Aplicaciones a medida). Grant it products, orders and customers " +
          "permissions. Shown only once at creation.",
        required: true,
        encrypted: true,
      },
      apiVersion: {
        type: "string",
        label: "API version",
        description: "Nuvemshop API version to use.",
        default: DEFAULT_API_VERSION,
      },
    });

    ctx.register.auth.apiKey({
      id: "nuvemshop-token",
      label: "Custom app access token",
      configField: "accessToken",
    });

    globalCtx.logger.info("Nuvemshop plugin config and auth registered");
  },

  async onValidateAuth(ctx) {
    const creds = readCredentials(ctx);
    if (!creds) {
      throw new Error("Store ID and Access token are required");
    }
    const apiVersion = ctx.config.getOptional<string>("apiVersion") || DEFAULT_API_VERSION;

    try {
      const store = await nuvemshopFetch<NuvemshopStore>(creds, apiVersion, "/store");
      ctx.logger.info("Nuvemshop credentials validated", { storeId: store.id });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.error("Failed to validate Nuvemshop credentials", { error: message });
      if (message.includes("HTTP 401")) {
        throw new Error(
          "Invalid access token — check the token from your custom app " +
            "(re-issuing a token invalidates the previous one).",
        );
      }
      if (message.includes("HTTP 402")) {
        throw new Error(
          "Nuvemshop returned 402 Payment Required — the store's subscription is unpaid, " +
            "so its API is suspended.",
        );
      }
      if (message.includes("HTTP 404")) {
        throw new Error("Store not found — check the Store ID.");
      }
      throw new Error(`Could not authenticate with Nuvemshop: ${message}`);
    }
  },

  async onStart(ctx) {
    ctx.logger.info("Starting Nuvemshop plugin for org", { orgId: ctx.org.id });

    const creds = readCredentials(ctx);
    if (!creds) {
      ctx.logger.info("Nuvemshop: credentials not configured yet — MCP not started.");
      return;
    }
    const apiVersion = ctx.config.getOptional<string>("apiVersion") || DEFAULT_API_VERSION;

    // Best-effort store lookup: the store's main language localizes i18n fields
    // ({es, pt, en} objects) for the agent, and main currency stamps the catalog.
    let mainLanguage = "pt";
    let currency: string | undefined;
    try {
      const store = await nuvemshopFetch<NuvemshopStore>(creds, apiVersion, "/store");
      if (store.main_language) mainLanguage = store.main_language;
      currency = store.main_currency;
    } catch (error) {
      ctx.logger.warn("Nuvemshop: could not fetch store info — using defaults", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await ctx.mcp.startLocalStdio({
        id: "nuvemshop-mcp",
        command: "node",
        args: ["index.js"],
        cwd: "./mcp",
        env: {
          NUVEMSHOP_STORE_ID: creds.storeId,
          NUVEMSHOP_ACCESS_TOKEN: creds.accessToken,
          NUVEMSHOP_API_VERSION: apiVersion,
          NUVEMSHOP_MAIN_LANGUAGE: mainLanguage,
        },
      });
      ctx.logger.info("Nuvemshop MCP server started successfully");
    } catch (error) {
      ctx.logger.error("Failed to start Nuvemshop MCP server", error);
      throw error;
    }

    // Products capability: mirror the catalog into core for `recommend_products`.
    if (ctx.productSource) {
      const productSource = ctx.productSource;
      void bulkSync(creds, apiVersion, mainLanguage, currency, productSource, {
        info: (msg, c) => ctx.logger.info(msg, c),
        error: (msg, c) => ctx.logger.error(msg, c as Record<string, unknown> | undefined),
      }).catch((err) => ctx.logger.error("Nuvemshop catalog sync failed", err));
    } else {
      ctx.logger.info(
        "Nuvemshop: productSource runtime not available — skipping catalog sync " +
          "(capability not negotiated or plugin-api credentials missing).",
      );
    }
  },

  async onConfigUpdate(ctx) {
    // The platform restarts the stdio MCP server with fresh env after this hook.
    ctx.logger.info("Nuvemshop plugin config updated");
  },

  async onDisable(ctx) {
    ctx.logger.info("Nuvemshop plugin disabled for org", { orgId: ctx.org.id });
  },
}));
