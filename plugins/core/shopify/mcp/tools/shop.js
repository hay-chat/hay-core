/**
 * Shop tool — basic store info. Doubles as a connectivity check for the token.
 */

const { shopifyGql } = require("../lib/client");
const { ok, fail } = require("../lib/format");

function registerShopTools(server) {
  server.tool(
    "shopify_get_shop",
    "Get basic information about the connected Shopify store (name, domain, plan, currency).",
    {},
    async () => {
      try {
        const data = await shopifyGql(
          `{ shop { name myshopifyDomain email currencyCode ianaTimezone plan { displayName } } }`,
        );
        return ok(data.shop);
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerShopTools };
