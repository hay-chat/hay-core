/**
 * Store tool — basic store facts. Doubles as a connectivity check.
 *
 *   nuvemshop_get_store  GET /store
 */

const { nsApi } = require("../lib/client");
const { ok, fail, pickLang, READ } = require("../lib/format");

function registerStoreTools(server) {
  server.registerTool(
    "nuvemshop_get_store",
    {
      description:
        "Get basic information about the connected store (name, URL, country, languages, " +
        "currency, contact email and phone).",
      inputSchema: {},
      annotations: READ,
    },
    async () => {
      try {
        const s = await nsApi("GET", "/store");
        return ok({
          id: s.id,
          name: pickLang(s.name),
          url: s.url_with_protocol || (s.original_domain ? `https://${s.original_domain}` : null),
          country: s.country ?? null,
          mainLanguage: s.main_language ?? null,
          languages: s.languages ? Object.keys(s.languages) : null,
          mainCurrency: s.main_currency ?? null,
          currencies: s.currencies ?? null,
          email: s.email ?? null,
          phone: s.phone || s.whatsapp_phone_number || null,
          contactEmail: s.contact_email ?? null,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerStoreTools };
