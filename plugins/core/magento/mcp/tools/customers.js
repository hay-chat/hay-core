/**
 * Customer tools: find (email → account + recent orders, guests included via
 * the orders' customer_email) and list (paged order history). No store-wide
 * order browsing on purpose.
 */

const { z } = require("zod");
const { magentoApi, searchCriteria } = require("../lib/client");
const { ok, fail } = require("../lib/format");
const { listOrdersByEmail, summarizeOrder } = require("../lib/orders");

function registerCustomerTools(server) {
  server.tool(
    "magento_find_customer",
    "Find a customer by email. Covers registered accounts and guest checkouts, and returns the " +
      "customer with their 5 most recent orders (recentOrders, with ids and numbers) so the next " +
      "step needs no extra lookup. found=false when nothing matches.",
    { email: z.string().describe("Email address used at checkout.") },
    async ({ email }) => {
      try {
        const needle = email.trim();
        if (!needle) throw new Error("Provide the customer's email address.");
        const [accounts, orders] = await Promise.all([
          magentoApi("GET", "/customers/search", {
            query: searchCriteria([{ field: "email", value: needle }], { pageSize: 1 }),
          }),
          listOrdersByEmail(needle, { pageSize: 5 }),
        ]);
        const account = accounts?.items?.[0] ?? null;
        if (!account && !orders.items.length) {
          return ok({
            found: false,
            message: `No customer or orders found for ${needle}. Ask for the email used at checkout.`,
          });
        }
        const first = orders.items[0];
        return ok({
          found: true,
          customer: {
            id: account?.id ?? null,
            isGuest: !account,
            email: account?.email ?? first?.customer_email ?? needle,
            firstName: account?.firstname ?? first?.customer_firstname ?? null,
            lastName: account?.lastname ?? first?.customer_lastname ?? null,
            ordersCount: orders.total,
          },
          recentOrders: orders.items.map(summarizeOrder),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "magento_list_customer_orders",
    "List a customer's orders by email (registered or guest), most recent first, one page at a time.",
    {
      email: z.string().describe("Email address used at checkout."),
      limit: z.number().int().optional().describe("Orders per page (default 10, max 100)."),
      page: z.number().int().optional().describe("Page number (default 1)."),
    },
    async ({ email, limit, page }) => {
      try {
        const pageSize = Math.min(limit ?? 10, 100);
        const { items, total } = await listOrdersByEmail(email.trim(), {
          pageSize,
          currentPage: page ?? 1,
        });
        return ok({
          items: items.map(summarizeOrder),
          page: page ?? 1,
          totalPages: Math.ceil(total / pageSize),
          total,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerCustomerTools };
