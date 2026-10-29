/**
 * Products: one `productSet` per catalogue product (creates or updates in place), matched by
 * handle, then by the first SKU. Variants keep their ids by SKU so re-runs don't recreate them.
 * Images go up through staged uploads, or come from `--image-base-url` when given.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { DEMO_TAG, IMAGES_DIR, log } from "../lib/data";
import type { Product } from "../lib/types";
import { assertNoUserErrors, type Shopify } from "./client";

const VENDOR = "Casa Aurora";
/** Shopify's option name for products without real options. */
const DEFAULT_OPTION = { name: "Title", value: "Default Title" };

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export interface ExistingProduct {
  id: string;
  hasMedia: boolean;
  /** SKU → variant id. */
  variantIds: Record<string, string>;
}

export const money = (amount: number) => amount.toFixed(2);

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function descriptionHtml(product: Product): string {
  const items = product.details.en.map((d) => `<li>${escapeHtml(d)}</li>`).join("");
  return `<p>${escapeHtml(product.description.en)}</p>${items ? `<ul>${items}</ul>` : ""}`;
}

/** The `ProductSetInput` for a catalogue product (store language: en, currency: USD). */
export function productSetInput(
  product: Product,
  options: { locationId: string; existing?: ExistingProduct; files?: string[] },
): Record<string, unknown> {
  const optionNames =
    product.options.length > 0 ? product.options.map((o) => o.en) : [DEFAULT_OPTION.name];
  const optionValues = (variantOptions: string[]) =>
    product.options.length > 0 ? variantOptions : [DEFAULT_OPTION.value];

  const productOptions = optionNames.map((name, i) => ({
    name,
    values: [...new Set(product.variants.map((v) => optionValues(v.options)[i]))].map((value) => ({
      name: value,
    })),
  }));

  const compareAt = product.compareAtPrice?.USD;
  const variants = product.variants.map((variant) => ({
    ...(options.existing?.variantIds[variant.sku]
      ? { id: options.existing.variantIds[variant.sku] }
      : {}),
    sku: variant.sku,
    optionValues: optionValues(variant.options).map((name, i) => ({
      optionName: optionNames[i],
      name,
    })),
    price: money(variant.price?.USD ?? product.price.USD),
    compareAtPrice: compareAt === undefined ? null : money(compareAt),
    taxable: true,
    inventoryPolicy: "DENY",
    inventoryItem: {
      tracked: true,
      requiresShipping: true,
      measurement: { weight: { unit: "GRAMS", value: product.weightGrams } },
    },
    inventoryQuantities: [
      { locationId: options.locationId, name: "available", quantity: variant.stock },
    ],
  }));

  return {
    ...(options.existing ? { id: options.existing.id } : {}),
    handle: product.handle,
    title: product.title.en,
    descriptionHtml: descriptionHtml(product),
    productType: product.category,
    vendor: VENDOR,
    status: "ACTIVE",
    tags: [
      ...new Set([
        ...product.tags,
        product.category,
        ...(product.fragile ? ["fragile"] : []),
        DEMO_TAG,
      ]),
    ],
    productOptions,
    variants,
    // Omitted on re-runs when the product already has media, so images aren't added twice.
    ...(options.files
      ? {
          files: options.files.map((src) => ({
            originalSource: src,
            alt: product.title.en,
            contentType: "IMAGE",
          })),
        }
      : {}),
  };
}

const FIND_PRODUCT = `
  query FindProduct($query: String!) {
    products(first: 1, query: $query) {
      nodes {
        id
        media(first: 1) { nodes { id } }
        variants(first: 100) { nodes { id sku } }
      }
    }
  }
`;

interface ProductNode {
  id: string;
  media: { nodes: { id: string }[] };
  variants: { nodes: { id: string; sku: string | null }[] };
}

export async function findProduct(
  shop: Shopify,
  product: Product,
): Promise<ExistingProduct | undefined> {
  if (shop.dryRun) return undefined;
  for (const query of [`handle:"${product.handle}"`, `sku:"${product.variants[0]?.sku}"`]) {
    const data = await shop.query<{ products: { nodes: ProductNode[] } }>(FIND_PRODUCT, { query });
    const node = data.products.nodes[0];
    if (node) {
      const variantIds = Object.fromEntries(
        node.variants.nodes.filter((v) => v.sku).map((v) => [v.sku as string, v.id]),
      );
      return { id: node.id, hasMedia: node.media.nodes.length > 0, variantIds };
    }
  }
  return undefined;
}

export async function primaryLocationId(shop: Shopify): Promise<string> {
  if (shop.dryRun) return "gid://shopify/Location/dry-run";
  const data = await shop.query<{ locations: { nodes: { id: string; name: string }[] } }>(
    `query Locations { locations(first: 1) { nodes { id name } } }`,
  );
  const location = data.locations.nodes[0];
  if (!location) throw new Error("The store has no location (needs read_locations).");
  log(`Location: ${location.name}`);
  return location.id;
}

const STAGED_UPLOADS = `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
}

/** Uploads one file from catalog/images/ and returns the URL productSet takes as originalSource. */
export async function stageImage(shop: Shopify, file: string): Promise<string> {
  const path = join(IMAGES_DIR, file);
  const mimeType = MIME[extname(file).toLowerCase()] ?? "image/jpeg";
  const fileSize = shop.dryRun && !existsSync(path) ? "0" : String(statSync(path).size);
  const data = await shop.mutate<{
    stagedUploadsCreate: { stagedTargets: StagedTarget[]; userErrors: [] };
  }>(
    STAGED_UPLOADS,
    {
      input: [
        {
          resource: "IMAGE",
          filename: file.split("/").pop(),
          mimeType,
          httpMethod: "POST",
          fileSize,
        },
      ],
    },
    {
      stagedUploadsCreate: {
        stagedTargets: [
          { url: "", resourceUrl: `https://dry-run.invalid/${file}`, parameters: [] },
        ],
        userErrors: [],
      },
    },
  );
  assertNoUserErrors("stagedUploadsCreate", data.stagedUploadsCreate);
  const target = data.stagedUploadsCreate.stagedTargets[0];
  if (shop.dryRun) {
    log(`  [dry-run] upload ${file} → staged target`);
    return target.resourceUrl;
  }
  // The staged target is a signed form post: its parameters first, the file last.
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([readFileSync(path)], { type: mimeType }), file.split("/").pop());
  const response = await fetch(target.url, { method: "POST", body: form });
  if (!response.ok)
    throw new Error(`Upload of ${file} failed: ${response.status} ${await response.text()}`);
  return target.resourceUrl;
}

/** Image sources for productSet: `<base>/<file>` with --image-base-url, else staged uploads. */
export async function imageSources(
  shop: Shopify,
  product: Product,
  imageBaseUrl?: string,
): Promise<string[]> {
  if (imageBaseUrl)
    return product.images.map((file) => `${imageBaseUrl.replace(/\/$/, "")}/${file}`);
  const sources: string[] = [];
  for (const file of product.images) {
    if (!existsSync(join(IMAGES_DIR, file)) && !shop.dryRun) {
      log(`  ! ${file} is missing from catalog/images/, skipped`);
      continue;
    }
    sources.push(await stageImage(shop, file));
  }
  return sources;
}

const PRODUCT_SET = `
  mutation ProductSet($input: ProductSetInput!) {
    productSet(input: $input, synchronous: true) {
      product { id handle variants(first: 100) { nodes { id sku } } }
      userErrors { field message code }
    }
  }
`;

/** Creates or updates every product. Returns SKU → variant id for the order step. */
export async function seedProducts(
  shop: Shopify,
  products: Product[],
  options: { imageBaseUrl?: string } = {},
): Promise<Record<string, string>> {
  const locationId = await primaryLocationId(shop);
  const variantIds: Record<string, string> = {};
  for (const product of products) {
    const existing = await findProduct(shop, product);
    const files = existing?.hasMedia
      ? undefined
      : await imageSources(shop, product, options.imageBaseUrl);
    const input = productSetInput(product, { locationId, existing, files });
    const data = await shop.mutate<{
      productSet: {
        product: { id: string; variants: { nodes: { id: string; sku: string }[] } };
        userErrors: [];
      };
    }>(
      PRODUCT_SET,
      { input },
      {
        productSet: {
          product: {
            id: `gid://shopify/Product/dry-run-${product.handle}`,
            variants: {
              nodes: product.variants.map((v) => ({
                id: `gid://shopify/ProductVariant/dry-run-${v.sku}`,
                sku: v.sku,
              })),
            },
          },
          userErrors: [],
        },
      },
    );
    assertNoUserErrors(`productSet ${product.handle}`, data.productSet);
    for (const v of data.productSet.product.variants.nodes) variantIds[v.sku] = v.id;
    log(
      `${existing ? "Updated" : "Created"} product ${product.handle} (${product.variants.length} variants)`,
    );
  }
  return variantIds;
}

/** SKU → variant id lookups for `--only orders` runs, where the product step didn't run. */
export async function findVariantIds(
  shop: Shopify,
  skus: string[],
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const sku of new Set(skus)) {
    if (shop.dryRun) {
      ids[sku] = `gid://shopify/ProductVariant/dry-run-${sku}`;
      continue;
    }
    const data = await shop.query<{ productVariants: { nodes: { id: string; sku: string }[] } }>(
      `query FindVariant($query: String!) { productVariants(first: 1, query: $query) { nodes { id sku } } }`,
      { query: `sku:"${sku}"` },
    );
    const variant = data.productVariants.nodes.find((v) => v.sku === sku);
    if (!variant)
      throw new Error(`SKU ${sku} is not in the store. Run without --only orders first.`);
    ids[sku] = variant.id;
  }
  return ids;
}
