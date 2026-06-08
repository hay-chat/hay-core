#!/usr/bin/env node
/**
 * Local Node MCP server for Shopify.
 *
 * Calls the Shopify Admin GraphQL API using an access token obtained via the
 * client credentials grant (minted + refreshed by the Hay Shopify plugin). The
 * token is injected via env on each worker start, so it is always current.
 *
 * Env (injected by the plugin worker):
 *   SHOPIFY_SHOP          myshopify.com domain (e.g. mystore.myshopify.com)
 *   SHOPIFY_ACCESS_TOKEN  Admin API access token (24h, auto-refreshed)
 *   SHOPIFY_API_VERSION   Admin API version (e.g. 2026-04)
 *
 * NOTE (HAY-219): this exposes a single `shopify_get_shop` tool to prove the
 * token round-trips. The full Orders / Customers / Products / Fulfillments tool
 * surface is implemented in HAY-219.
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

async function adminGraphql(query, variables) {
  if (!SHOP || !TOKEN) {
    throw new Error("Shopify MCP server is missing SHOPIFY_SHOP or SHOPIFY_ACCESS_TOKEN");
  }

  const response = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify Admin API error (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }

  const json = await response.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

const server = new McpServer({ name: "shopify", version: "1.0.0" });

server.tool(
  "shopify_get_shop",
  "Get basic information about the connected Shopify store (name, domain, plan, currency).",
  {},
  async () => {
    try {
      const data = await adminGraphql(
        `{ shop { name myshopifyDomain email currencyCode ianaTimezone plan { displayName } } }`,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data.shop, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
      };
    }
  },
);

// TODO (HAY-219): register orders, customers, products and fulfillments tools.

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[shopify] MCP server started");
}

main().catch((err) => {
  console.error("Shopify MCP server failed to start:", err);
  process.exit(1);
});
