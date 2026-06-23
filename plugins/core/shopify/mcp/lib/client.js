/**
 * Shopify Admin GraphQL client for the Shopify MCP server.
 *
 * Credentials are injected by the plugin worker via env (both managed and
 * self-hosted modes resolve to the same three vars):
 *   SHOPIFY_SHOP          myshopify.com domain (e.g. mystore.myshopify.com)
 *   SHOPIFY_ACCESS_TOKEN  Admin API access token
 *   SHOPIFY_API_VERSION   Admin API version (e.g. 2026-04)
 */

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a GraphQL operation against the Shopify Admin API.
 *
 * Retries on 429 / 5xx with linear backoff. Throws on transport errors,
 * non-2xx responses, and GraphQL `errors` returned on a 200.
 *
 * @param {string} query - GraphQL query or mutation
 * @param {Record<string, unknown>} [variables]
 * @returns {Promise<any>} the `data` object
 */
async function shopifyGql(query, variables = {}) {
  if (!SHOP || !TOKEN) {
    throw new Error("Shopify MCP server is missing SHOPIFY_SHOP or SHOPIFY_ACCESS_TOKEN");
  }

  const url = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
  let lastErr;

  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": TOKEN,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      lastErr = err;
      await sleep(attempt * 500);
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      lastErr = new Error(`Shopify Admin API transient error (HTTP ${response.status})`);
      await sleep(attempt * 800);
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Shopify Admin API error (HTTP ${response.status}): ${text.slice(0, 300)}`);
    }

    const json = await response.json();
    if (Array.isArray(json.errors) && json.errors.length > 0) {
      throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
    }
    return json.data;
  }

  throw lastErr || new Error("Shopify Admin API request failed after retries");
}

module.exports = { shopifyGql, SHOP, API_VERSION };
