/**
 * D10-6: recognise a marketplace order in a store's "order not found" path.
 *
 * Shoppers often give an order number from Mercado Livre, Shopee, Amazon, Magalu
 * or TikTok Shop. Those orders live on the marketplace, not in the store, so the
 * agent should say so plainly and point to that marketplace's after-sale flow
 * instead of asking for the number again. Product problems (a defect, damage)
 * are still the brand's to handle.
 *
 * The ID patterns are common knowledge and UNVERIFIED against real IDs:
 *   Mercado Livre  ~16 digits starting with "2000"
 *   Amazon         3-7-7 digits (e.g. 701-1234567-1234567)
 *   Shopee         14 characters, YYMMDD + 8 alphanumerics (at least one letter)
 * Marketplace names typed into the reference are matched as keywords.
 */

const { toolError } = require("../tool-errors/index.cjs");

const MARKETPLACES = [
  {
    id: "mercado_livre",
    label: "Mercado Livre",
    keywords: [/mercado\s*livre/i, /mercado\s*libre/i, /\bmeli\b/i],
    pattern: /^2000\d{9,13}$/,
    afterSale:
      'In the Mercado Livre app or site, open "Minhas compras", choose the purchase and use ' +
      "its help or return options.",
  },
  {
    id: "amazon",
    label: "Amazon",
    keywords: [/\bamazon\b/i],
    pattern: /^\d{3}-\d{7}-\d{7}$/,
    afterSale:
      'On Amazon, open "Seus pedidos" (Your Orders), choose the order and use its help or return options.',
  },
  {
    id: "shopee",
    label: "Shopee",
    keywords: [/\bshopee\b/i],
    pattern: /^\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8}$/i,
    afterSale:
      'In the Shopee app, open "Eu" > "Minhas compras", choose the order and use "Solicitar ' +
      'devolução/reembolso" or the chat with the seller there.',
  },
  {
    id: "magalu",
    label: "Magalu",
    keywords: [/\bmagalu\b/i, /magazine\s*luiza/i],
    pattern: null,
    afterSale:
      'In the Magalu app or site, open "Meus pedidos", choose the order and use its help options.',
  },
  {
    id: "tiktok_shop",
    label: "TikTok Shop",
    keywords: [/tik\s*tok/i],
    pattern: null,
    afterSale:
      'In the TikTok app, open your profile > "Pedidos", choose the order and use its help options.',
  },
];

/**
 * The marketplace an order reference points to, or null.
 * @param {unknown} ref - the order id/number/name the shopper gave
 * @returns {{ id: string, label: string, afterSale: string, matchedBy: "keyword" | "id_pattern" } | null}
 */
function detectMarketplace(ref) {
  const raw = String(ref ?? "").trim();
  if (!raw) return null;
  for (const m of MARKETPLACES) {
    if (m.keywords.some((k) => k.test(raw))) {
      return { id: m.id, label: m.label, afterSale: m.afterSale, matchedBy: "keyword" };
    }
  }
  const compact = raw.replace(/^#/, "").replace(/\s+/g, "");
  for (const m of MARKETPLACES) {
    if (m.pattern && m.pattern.test(compact)) {
      return { id: m.id, label: m.label, afterSale: m.afterSale, matchedBy: "id_pattern" };
    }
  }
  return null;
}

const GENERIC_HINT =
  "If the customer bought it on a marketplace (Mercado Livre, Shopee, Amazon, Magalu, TikTok " +
  "Shop), the order is not in this store: send them to that marketplace's order page.";

/**
 * NOT_FOUND ToolError for an order lookup, with marketplace routing when the
 * reference looks like a marketplace order and a short generic hint otherwise.
 * @param {unknown} ref
 * @param {string} message - the store's usual not-found guidance
 */
function orderNotFoundError(ref, message) {
  const marketplace = detectMarketplace(ref);
  if (!marketplace) return toolError("NOT_FOUND", `${message} ${GENERIC_HINT}`);
  const likely = marketplace.matchedBy === "id_pattern" ? "looks like" : "mentions";
  return toolError(
    "NOT_FOUND",
    `Order ${ref} is not in this store and ${likely} a ${marketplace.label} order. Tell the ` +
      `customer plainly that orders bought on ${marketplace.label} are handled there: ` +
      `${marketplace.afterSale} If the problem is with the product itself (a defect or ` +
      "damage), still help or hand the conversation to the store team. If the customer says " +
      `it was not a ${marketplace.label} order: ${message}`,
    { details: { marketplace: marketplace.id, matchedBy: marketplace.matchedBy } },
  );
}

module.exports = { detectMarketplace, orderNotFoundError, MARKETPLACES };
