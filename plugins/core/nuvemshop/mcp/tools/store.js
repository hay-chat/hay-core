// tools/store.js — store info / connectivity check.
// Registrar: registerStoreTools

const { nuvemshopApi } = require("../lib/client");
const { ok, fail, pickLang } = require("../lib/format");

function registerStoreTools(server) {
  // TODO: like shopify_get_shop, this is really static session context — fold it
  // into an SDK context hook once one exists.
  server.tool(
    "nuvemshop_get_store",
    "Get basic store info (name, domain, main language, currencies, country). Doubles as a connectivity check.",
    {},
    async () => {
      try {
        const store = await nuvemshopApi("GET", "/store");
        return ok({
          id: store.id,
          name: pickLang(store.name),
          url: store.url_with_protocol || store.original_domain,
          country: store.country,
          main_language: store.main_language,
          languages: store.languages,
          main_currency: store.main_currency,
          email: store.email,
          plan_name: store.plan_name,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerStoreTools };
