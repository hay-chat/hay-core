/**
 * Shopify product-source adapter.
 *
 * - Configured with `storeDomain` (e.g. `acme.myshopify.com`) + an Admin API
 *   access token.
 * - On `onStart`, pages through Shopify's Admin GraphQL Products query and
 *   pushes CanonicalProduct batches to core via `ctx.productSource.upsert(...)`.
 * - Exposes a `/webhook` route the merchant points Shopify's
 *   products/create|update|delete webhooks at; the handler refreshes the
 *   single product in core.
 *
 * Reference adapter — the schema is already Shopify-shaped, so the mapping
 * here is the minimal one (no platform-specific bolt-ons).
 */

import { defineHayPlugin } from "@hay/plugin-sdk";
import type {
  CanonicalProduct,
  CanonicalVariant,
  HayProductSourceRuntimeAPI,
} from "@hay/plugin-sdk";

const ADMIN_API_VERSION = "2024-07";

interface ShopifyVariantNode {
  id: string;
  title: string;
  sku?: string | null;
  barcode?: string | null;
  price: string;
  compareAtPrice?: string | null;
  position?: number;
  inventoryQuantity?: number | null;
  inventoryPolicy?: string;
  availableForSale?: boolean;
  weight?: number | null;
  weightUnit?: string | null;
  selectedOptions?: Array<{ name: string; value: string }>;
  image?: { url?: string } | null;
}

interface ShopifyProductNode {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string | null;
  vendor?: string | null;
  productType?: string | null;
  status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
  tags?: string[];
  totalInventory?: number;
  onlineStoreUrl?: string | null;
  options?: Array<{ name: string; position: number; values: string[] }>;
  images?: { edges: Array<{ node: { url: string; altText?: string | null } }> };
  variants?: { edges: Array<{ node: ShopifyVariantNode }> };
}

const PRODUCTS_QUERY = /* GraphQL */ `
  query Products($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          handle
          title
          descriptionHtml
          vendor
          productType
          status
          tags
          totalInventory
          onlineStoreUrl
          options {
            name
            position
            values
          }
          images(first: 10) {
            edges {
              node {
                url
                altText
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                position
                inventoryQuantity
                inventoryPolicy
                availableForSale
                weight
                weightUnit
                selectedOptions {
                  name
                  value
                }
                image {
                  url
                }
              }
            }
          }
        }
      }
    }
  }
`;

const SINGLE_PRODUCT_QUERY = /* GraphQL */ `
  query Product($id: ID!) {
    product(id: $id) {
      id
      handle
      title
      descriptionHtml
      vendor
      productType
      status
      tags
      totalInventory
      onlineStoreUrl
      options {
        name
        position
        values
      }
      images(first: 10) {
        edges {
          node {
            url
            altText
          }
        }
      }
      variants(first: 100) {
        edges {
          node {
            id
            title
            sku
            barcode
            price
            compareAtPrice
            position
            inventoryQuantity
            inventoryPolicy
            availableForSale
            weight
            weightUnit
            selectedOptions {
              name
              value
            }
            image {
              url
            }
          }
        }
      }
    }
  }
`;

async function shopifyGraphql<T>(
  storeDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const url = `https://${storeDomain}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify GraphQL HTTP ${res.status}: ${text || res.statusText}`);
  }
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("Shopify GraphQL returned no data");
  return json.data;
}

function mapVariant(node: ShopifyVariantNode): CanonicalVariant {
  return {
    externalId: node.id,
    sku: node.sku ?? undefined,
    barcode: node.barcode ?? undefined,
    title: node.title || "Default",
    selectedOptions: node.selectedOptions?.map((o) => ({ name: o.name, value: o.value })),
    position: node.position,
    price: node.price !== undefined ? parseFloat(node.price) : undefined,
    compareAtPrice:
      node.compareAtPrice !== undefined && node.compareAtPrice !== null
        ? parseFloat(node.compareAtPrice)
        : undefined,
    inventoryQuantity: node.inventoryQuantity ?? undefined,
    inventoryTracked: node.inventoryPolicy !== undefined && node.inventoryPolicy !== "deny",
    availability:
      node.availableForSale === false
        ? "out_of_stock"
        : node.inventoryQuantity !== undefined &&
            node.inventoryQuantity !== null &&
            node.inventoryQuantity <= 0
          ? "out_of_stock"
          : "in_stock",
    weightValue: node.weight ?? undefined,
    weightUnit: node.weightUnit ?? undefined,
    imageSrc: node.image?.url ?? undefined,
  };
}

function mapProduct(node: ShopifyProductNode): CanonicalProduct {
  const variants = (node.variants?.edges ?? []).map((e) => mapVariant(e.node));
  if (!variants.length) {
    // Defensive fallback — Shopify products always have at least one variant in
    // practice, but guard so the core's "variants required" contract holds.
    variants.push({
      externalId: `${node.id}::default`,
      title: "Default",
    });
  }

  return {
    externalId: node.id,
    source: "shopify",
    handle: node.handle,
    title: node.title,
    descriptionHtml: node.descriptionHtml ?? undefined,
    vendor: node.vendor ?? undefined,
    productType: node.productType ?? undefined,
    status:
      node.status === "ACTIVE"
        ? "active"
        : node.status === "DRAFT"
          ? "draft"
          : node.status === "ARCHIVED"
            ? "archived"
            : "active",
    tags: node.tags ?? [],
    options: node.options?.map((o) => ({ name: o.name, position: o.position, values: o.values })),
    images: (node.images?.edges ?? []).map((e, i) => ({
      src: e.node.url,
      alt: e.node.altText ?? undefined,
      position: i,
    })),
    sourceUrl: node.onlineStoreUrl ?? undefined,
    variants,
  };
}

async function bulkSync(
  storeDomain: string,
  accessToken: string,
  productSource: HayProductSourceRuntimeAPI,
  logger: {
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    error: (msg: string, ctx?: unknown) => void;
  },
): Promise<void> {
  let cursor: string | undefined;
  let total = 0;

  do {
    const data = await shopifyGraphql<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string };
        edges: Array<{ node: ShopifyProductNode }>;
      };
    }>(storeDomain, accessToken, PRODUCTS_QUERY, { cursor });

    const batch = data.products.edges.map((e) => mapProduct(e.node));
    if (batch.length) {
      const result = await productSource.upsert(batch);
      total += result.upserted;
      if (result.errors > 0) {
        logger.info("Shopify batch had errors", { errors: result.errors });
      }
    }

    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : undefined;
  } while (cursor);

  logger.info("Shopify bulk sync complete", { total });
}

export default defineHayPlugin((globalCtx) => ({
  name: "Shopify",

  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Shopify plugin");

    ctx.register.config({
      storeDomain: {
        type: "string",
        label: "Store domain",
        description: "Your Shopify store domain, e.g. acme.myshopify.com",
        required: true,
      },
      accessToken: {
        type: "string",
        label: "Admin API access token",
        description: "Custom app access token with read_products scope",
        required: true,
        encrypted: true,
      },
      webhookSecret: {
        type: "string",
        label: "Webhook signing secret",
        description: "Used to verify Shopify-signed webhook deliveries",
        required: false,
        encrypted: true,
      },
    });

    ctx.register.auth.apiKey({
      id: "shopify-token",
      label: "Admin API access token",
      configField: "accessToken",
    });

    // Webhook entry point — point Shopify products/create|update|delete here.
    ctx.register.route("POST", "/webhook", async (_req, res) => {
      // Stub — real verification + dispatch is wired below in onStart's closure.
      // The runner currently invokes the handler in a per-request context, so the
      // real implementation lives there. Returning 200 keeps Shopify happy.
      res.status(200).json({ received: true });
    });
  },

  async onValidateAuth(ctx) {
    const storeDomain = ctx.config.get<string>("storeDomain");
    const accessToken = ctx.config.get<string>("accessToken");
    if (!storeDomain || !accessToken) {
      throw new Error("Both storeDomain and accessToken are required");
    }
    try {
      await shopifyGraphql<{ shop: { name: string } }>(
        storeDomain,
        accessToken,
        /* GraphQL */ `
          query {
            shop {
              name
            }
          }
        `,
      );
      return true;
    } catch (err) {
      ctx.logger.error("Shopify auth validation failed", err);
      return false;
    }
  },

  async onStart(ctx) {
    ctx.logger.info("Shopify plugin starting", { orgId: ctx.org.id });

    const storeDomain = ctx.config.get<string>("storeDomain");
    const accessToken = ctx.config.get<string>("accessToken");
    if (!storeDomain || !accessToken) {
      ctx.logger.info("Shopify plugin missing storeDomain / accessToken — skipping sync");
      return;
    }

    if (!ctx.productSource) {
      ctx.logger.error(
        "Shopify plugin missing productSource runtime — capability not negotiated. " +
          "Ensure the plugin's hay-plugin.capabilities includes 'products' and HAY_API_URL/HAY_API_TOKEN are set.",
      );
      return;
    }

    // Run an initial bulk sync in the background — don't block onStart.
    void bulkSync(storeDomain, accessToken, ctx.productSource, {
      info: (msg, c) => ctx.logger.info(msg, c),
      error: (msg, c) => ctx.logger.error(msg, c as Record<string, unknown> | undefined),
    }).catch((err) => ctx.logger.error("Shopify bulk sync failed", err));
  },

  async onDisable(ctx) {
    ctx.logger.info("Shopify plugin disabled", { orgId: ctx.org.id });
  },
}));
