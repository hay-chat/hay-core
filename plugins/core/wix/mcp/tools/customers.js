/**
 * Customer tools. Wix buyers are Contacts, but reading them needs the extra
 * Contacts scope the plugin does not ask for — so the customer view is
 * derived from their orders (buyerInfo + billing contact details), which is
 * all a support conversation needs. Exactly two lookups on purpose: find
 * (email → customer + recent orders) and list (paged order history).
 *
 * There is deliberately NO store-wide order search: a customer-facing agent
 * must only see orders belonging to the customer it is talking to.
 */

const { z } = require("zod");
const { ok, fail } = require("../lib/format");
const { searchOrders, summarizeOrder } = require("../lib/orders");

function customerFromOrders(email, orders) {
  const first = orders[0];
  const contact =
    first?.billingInfo?.contactDetails ||
    first?.shippingInfo?.logistics?.shippingDestination?.contactDetails ||
    {};
  return {
    email,
    contactId: first?.buyerInfo?.contactId ?? null,
    memberId: first?.buyerInfo?.memberId ?? null,
    firstName: contact.firstName ?? null,
    lastName: contact.lastName ?? null,
    phone: contact.phone ?? null,
  };
}

function registerCustomerTools(server) {
  server.tool(
    "wix_find_customer",
    "Find a customer by email address. Returns the customer (name, contact id) and their 5 most " +
      "recent orders (recentOrders, with order ids and numbers) so the next step needs no extra " +
      "lookup. Returns found=false when no order exists for that email.",
    {
      email: z.string().describe("The buyer's email address."),
    },
    async ({ email }) => {
      try {
        const needle = email.trim();
        if (!needle) throw new Error("Provide the buyer's email address.");
        const { orders, hasNext } = await searchOrders({ "buyerInfo.email": needle }, { limit: 5 });
        if (!orders.length) {
          return ok({
            found: false,
            message: `No orders found for ${needle}. Ask the buyer for the email used at checkout.`,
          });
        }
        return ok({
          found: true,
          customer: customerFromOrders(needle, orders),
          recentOrders: orders.map(summarizeOrder),
          hasMoreOrders: hasNext,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "wix_list_customer_orders",
    "List a customer's orders by email, most recent first, one page at a time.",
    {
      email: z.string().describe("The buyer's email address."),
      limit: z.number().int().optional().describe("Max orders per page (default 10, max 100)."),
      cursor: z.string().optional().describe("nextCursor from a previous page."),
    },
    async ({ email, limit, cursor }) => {
      try {
        const needle = email.trim();
        if (!needle) throw new Error("Provide the buyer's email address.");
        const page = await searchOrders(
          { "buyerInfo.email": needle },
          { limit: Math.min(limit ?? 10, 100), cursor },
        );
        return ok({
          items: page.orders.map(summarizeOrder),
          hasNext: page.hasNext,
          nextCursor: page.nextCursor,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerCustomerTools, customerFromOrders };
