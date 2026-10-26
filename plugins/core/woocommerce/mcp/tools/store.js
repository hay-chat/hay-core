/**
 * Store tool — basic store facts (currency, URL, versions). Doubles as a
 * connectivity check for the credentials.
 */

const { wcApi } = require("../lib/client");
const { ok, fail } = require("../lib/format");

function registerStoreTools(server) {
  server.tool(
    "woocommerce_get_store",
    "Get basic information about the connected store (name, URL, currency, WooCommerce version).",
    {},
    async () => {
      try {
        const status = await wcApi("GET", "/system_status");
        const env = status?.environment || {};
        const settings = status?.settings || {};
        return ok({
          siteUrl: env.site_url || env.home_url || null,
          wordpressVersion: env.wp_version || null,
          wooCommerceVersion: env.version || null,
          currency: settings.currency || null,
          currencySymbol: settings.currency_symbol || null,
          taxesEnabled: settings.taxes_enabled ?? null,
          timezone: env.default_timezone || null,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerStoreTools };
