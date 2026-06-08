// tools/products.js — Shopify Admin GraphQL product tools (API version 2026-04)
// Registrar: registerProductTools

const { z } = require("zod");
const { shopifyGql } = require("../lib/client");
const { ok, fail, unwrapConnection, pageInfo, toGid, assertNoUserErrors } = require("../lib/format");

function registerProductTools(server) {
  server.tool(
    "shopify_get_product",
    "Get a single product by id (GID or numeric) including variants.",
    {
      id: z.string().describe("Product id (GID like gid://shopify/Product/123 or bare numeric)"),
      variantsFirst: z.number().int().optional().describe("Number of variants to fetch (default 50)"),
    },
    async (args) => {
      try {
        const variables = {
          id: toGid("Product", args.id),
          variantsFirst: args.variantsFirst ?? 50,
        };
        const data = await shopifyGql(
          `query GetProduct($id: ID!, $variantsFirst: Int!) {
            product(id: $id) {
              id
              title
              handle
              status
              description
              totalInventory
              priceRangeV2 {
                minVariantPrice { amount currencyCode }
                maxVariantPrice { amount currencyCode }
              }
              variants(first: $variantsFirst) {
                nodes {
                  id
                  title
                  sku
                  price
                  compareAtPrice
                  availableForSale
                  inventoryQuantity
                  selectedOptions { name value }
                }
              }
            }
          }`,
          variables
        );
        return ok(data.product);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    "shopify_get_product_by_handle",
    "Get a single product by handle including variants.",
    {
      handle: z.string().describe("Product handle (e.g. 'blue-shirt')"),
      variantsFirst: z.number().int().optional().describe("Number of variants to fetch (default 50)"),
    },
    async (args) => {
      try {
        const variables = {
          handle: args.handle,
          variantsFirst: args.variantsFirst ?? 50,
        };
        // productByHandle is deprecated; using productByIdentifier with handle.
        // TODO(HAY-219 §8): verify productByIdentifier{ identifier: { handle } } against a real dev store.
        const data = await shopifyGql(
          `query GetProductByHandle($handle: String!, $variantsFirst: Int!) {
            productByIdentifier(identifier: { handle: $handle }) {
              id
              title
              handle
              status
              description
              totalInventory
              priceRangeV2 {
                minVariantPrice { amount currencyCode }
                maxVariantPrice { amount currencyCode }
              }
              variants(first: $variantsFirst) {
                nodes {
                  id
                  title
                  sku
                  price
                  compareAtPrice
                  availableForSale
                  inventoryQuantity
                  selectedOptions { name value }
                }
              }
            }
          }`,
          variables
        );
        return ok(data.productByIdentifier);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    "shopify_search_products",
    "Search products by title. Returns { items, pageInfo }.",
    {
      title: z.string().describe("Title fragment to search for"),
      first: z.number().int().optional().describe("Number of results to fetch (default 25)"),
      sortKey: z
        .enum(["RELEVANCE", "TITLE", "PRODUCT_TYPE", "VENDOR", "INVENTORY_TOTAL", "UPDATED_AT", "CREATED_AT", "PRICE", "ID"])
        .optional()
        .describe("Sort key (default RELEVANCE)"),
      after: z.string().optional().describe("Pagination cursor (endCursor from a previous page)"),
    },
    async (args) => {
      try {
        // TODO(HAY-219 §8): verify wildcard search syntax 'title:*<title>*' against a real dev store.
        const query = `title:*${args.title}*`;
        const variables = {
          first: args.first ?? 25,
          query,
          sortKey: args.sortKey ?? "RELEVANCE",
          after: args.after,
        };
        const data = await shopifyGql(
          `query SearchProducts($first: Int!, $query: String!, $sortKey: ProductSortKeys!, $after: String) {
            products(first: $first, query: $query, sortKey: $sortKey, after: $after) {
              nodes {
                id
                title
                handle
                status
                totalInventory
                priceRangeV2 {
                  minVariantPrice { amount currencyCode }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }`,
          variables
        );
        return ok({
          items: unwrapConnection(data.products),
          pageInfo: pageInfo(data.products),
        });
      } catch (err) {
        return fail(err);
      }
    }
  );
}

module.exports = { registerProductTools };
