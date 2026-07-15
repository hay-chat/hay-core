/**
 * Shop tool — basic store info. Doubles as a connectivity check for the token.
 *
 * TODO: this is config, not a tool — store name/domain/currency don't change
 * mid-conversation. Once the plugin SDK supports injecting static context into
 * the agent at session start, move this data there and drop the tool (saves one
 * call and one decision per conversation). No such SDK hook exists today.
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
