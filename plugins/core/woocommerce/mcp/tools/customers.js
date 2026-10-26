/**
 * Customer tools. WooCommerce has registered customers AND guest checkouts,
 * so "find customer" merges two reads: /customers?email (registered account)
 * and /orders?search (guest orders carry the email only on the order). No
 * store-wide order browsing is exposed on purpose — a customer-facing agent
 * must only see the orders of the customer it is talking to.
 */

const { z } = require("zod");
const { wcList } = require("../lib/client");
const { ok, fail } = require("../lib/format");
const { summarizeOrder } = require("../lib/orders");

const sameEmail = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
const digits = (s) => String(s || "").replace(/\D/g, "");

/** Orders whose billing email/phone actually matches (search is fuzzy). */
function filterOrders(orders, { email, phone }) {
  return orders.filter((o) => {
    if (email && sameEmail(o.billing?.email, email)) return true;
    if (phone && digits(phone) && digits(o.billing?.phone).endsWith(digits(phone).slice(-8))) {
      return true;
    }
    return false;
  });
}

function registerCustomerTools(server) {
  server.tool(
    "woocommerce_find_customer",
    "Find a customer by email and/or phone. Covers registered accounts and guest checkouts, and " +
      "returns the customer with their 5 most recent orders (recentOrders, with ids and numbers) " +
      "so the next step needs no extra lookup. found=false when nothing matches.",
    {
      email: z.string().optional().describe("Email address used at checkout."),
      phone: z.string().optional().describe("Billing phone number (any format)."),
    },
    async ({ email, phone }) => {
      try {
        if (!email && !phone) throw new Error("Provide an email and/or a phone number.");

        let account = null;
        if (email) {
          const { items } = await wcList("/customers", { email, per_page: 1 });
          account = items.find((c) => sameEmail(c.email, email)) || null;
        }

        const { items: found } = await wcList("/orders", {
          search: email || phone,
          per_page: 10,
          orderby: "date",
          order: "desc",
        });
        let orders = filterOrders(found, { email, phone });
        if (account) {
          const { items: own } = await wcList("/orders", { customer: account.id, per_page: 5 });
          const seen = new Set(orders.map((o) => o.id));
          orders = orders.concat(own.filter((o) => !seen.has(o.id)));
        }
        orders.sort((a, b) => String(b.date_created).localeCompare(String(a.date_created)));

        if (!account && !orders.length) {
          return ok({
            found: false,
            message: `No customer or orders found for ${email || phone}. Ask for the email used at checkout.`,
          });
        }
        const first = orders[0];
        return ok({
          found: true,
          customer: {
            id: account?.id ?? null,
            isGuest: !account,
            email: account?.email ?? first?.billing?.email ?? email ?? null,
            firstName: account?.first_name || first?.billing?.first_name || null,
            lastName: account?.last_name || first?.billing?.last_name || null,
            phone: account?.billing?.phone || first?.billing?.phone || phone || null,
            ordersCount: account?.orders_count ?? orders.length,
            totalSpent: account?.total_spent ?? null,
          },
          recentOrders: orders.slice(0, 5).map(summarizeOrder),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "woocommerce_list_customer_orders",
    "List a customer's orders by email (registered or guest), most recent first, one page at a time.",
    {
      email: z.string().describe("Email address used at checkout."),
      limit: z.number().int().optional().describe("Orders per page (default 10, max 100)."),
      page: z.number().int().optional().describe("Page number (default 1)."),
    },
    async ({ email, limit, page }) => {
      try {
        const perPage = Math.min(limit ?? 10, 100);
        const { items, total, totalPages } = await wcList("/orders", {
          search: email,
          per_page: perPage,
          page: page ?? 1,
          orderby: "date",
          order: "desc",
        });
        return ok({
          items: filterOrders(items, { email }).map(summarizeOrder),
          page: page ?? 1,
          totalPages,
          total,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerCustomerTools, filterOrders };
