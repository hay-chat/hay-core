/**
 * Store tool — basic store facts (currency, locale, URLs). Doubles as a
 * connectivity check for the token.
 */

const { magentoApi } = require("../lib/client");
const { ok, fail } = require("../lib/format");

function registerStoreTools(server) {
  server.tool(
    "magento_get_store",
    "Get basic information about the connected store (name/code, base URL, currency, locale).",
    {},
    async () => {
      try {
        const configs = await magentoApi("GET", "/store/storeConfigs");
        const c = (Array.isArray(configs) ? configs : [])[0] || {};
        return ok({
          storeCode: c.code ?? null,
          websiteId: c.website_id ?? null,
          baseUrl: c.base_url ?? null,
          locale: c.locale ?? null,
          currency: c.base_currency_code ?? null,
          displayCurrency: c.default_display_currency_code ?? null,
          timezone: c.timezone ?? null,
          weightUnit: c.weight_unit ?? null,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerStoreTools };
