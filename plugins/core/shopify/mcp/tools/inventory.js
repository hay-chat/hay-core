// tools/inventory.js — Shopify Admin GraphQL MCP server (API version 2026-04)
// Inventory-related tools: variant/SKU stock checks across locations.
const { z } = require("zod");
const { shopifyGql } = require("../lib/client");
const { ok, fail, unwrapConnection, pageInfo, toGid, assertNoUserErrors } = require("../lib/format");

const VARIANT_NODE_FIELDS = `
  id
  sku
  price
  availableForSale
  inventoryQuantity
  inventoryItem {
    id
    tracked
    inventoryLevels(first: 20) {
      nodes {
        location { id name }
        quantities(names: $quantityNames) { name quantity }
      }
    }
  }
`;

function registerInventoryTools(server) {
  server.tool(
    "shopify_check_inventory",
    "Check inventory levels for a variant by id or SKU across all locations. Provide exactly one of variantId or sku.",
    {
      variantId: z
        .string()
        .optional()
        .describe("ProductVariant GID or bare numeric id. Provide exactly one of variantId or sku."),
      sku: z
        .string()
        .optional()
        .describe("Variant SKU to look up. Provide exactly one of variantId or sku."),
      quantityNames: z
        .array(z.enum(["available", "on_hand", "committed"]))
        .optional()
        .describe("Inventory quantity states to return. Defaults to [\"available\"]."),
    },
    async (args) => {
      try {
        const hasVariantId = typeof args.variantId === "string" && args.variantId.length > 0;
        const hasSku = typeof args.sku === "string" && args.sku.length > 0;
        if (hasVariantId === hasSku) {
          return fail(new Error("Provide exactly one of variantId or sku."));
        }

        // quantities(names:) is required ([String!]!) — always pass at least ["available"].
        const quantityNames =
          Array.isArray(args.quantityNames) && args.quantityNames.length > 0
            ? args.quantityNames
            : ["available"];

        if (hasVariantId) {
          const variables = {
            variantId: toGid("ProductVariant", args.variantId),
            quantityNames,
          };
          const query = `
            query CheckInventoryById($variantId: ID!, $quantityNames: [String!]!) {
              productVariant(id: $variantId) {
                ${VARIANT_NODE_FIELDS}
              }
            }
          `;
          const data = await shopifyGql(query, variables);
          return ok({ variant: data.productVariant });
        }

        // IMPORTANT (verify): productVariantByIdentifier does NOT accept SKU in 2026-04 —
        // the SKU path MUST use productVariants(query:"sku:...").
        // TODO(HAY-219 §8): verify productVariantByIdentifier does not accept SKU against a real dev store.
        const variables = {
          query: `sku:${args.sku}`,
          quantityNames,
        };
        const query = `
          query CheckInventoryBySku($query: String!, $quantityNames: [String!]!) {
            productVariants(first: 1, query: $query) {
              nodes {
                ${VARIANT_NODE_FIELDS}
              }
            }
          }
        `;
        const data = await shopifyGql(query, variables);
        const nodes = unwrapConnection(data.productVariants);
        return ok({ variant: nodes[0] || null });
      } catch (err) {
        return fail(err);
      }
    }
  );
}

module.exports = { registerInventoryTools };
