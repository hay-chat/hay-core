/**
 * Customer tools. WooCommerce has registered customers AND guest checkouts,
 * so "find customer" merges two reads: /customers?email (registered account)
 * and /orders?search (guest orders carry the email only on the order). No
 * store-wide order browsing is exposed on purpose — a customer-facing agent
 * must only see the orders of the customer it is talking to.
 */

const { z } = require("zod");
const { wcApi, wcList } = require("../lib/client");
const { ok, fail, toolError } = require("../lib/format");
const { summarizeOrder } = require("../lib/orders");

const sameEmail = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
const digits = (s) => String(s || "").replace(/\D/g, "");
/** The part of a phone number that survives formatting differences. */
const phoneKey = (phone) => digits(phone).slice(-8);

/** Orders whose billing email/phone actually matches (search is fuzzy). */
function filterOrders(orders, { email, phone }) {
  const key = phoneKey(phone);
  return orders.filter((o) => {
    if (email && sameEmail(o.billing?.email, email)) return true;
    if (key && digits(o.billing?.phone).endsWith(key)) return true;
    return false;
  });
}

async function findAccount(email) {
  if (!email) return null;
  const { items } = await wcList("/customers", { email, per_page: 1 });
  return items.find((c) => sameEmail(c.email, email)) || null;
}

/** The registered account for an email, or a PRECONDITION error for guests. */
async function requireAccount(email) {
  const account = await findAccount(email);
  if (!account) {
    throw toolError(
      "PRECONDITION",
      `No registered customer account uses ${email} (it may be a guest checkout). There is no ` +
        "saved profile to change; for an order not yet shipped use " +
        "woocommerce_update_order_shipping_address.",
      { details: { reason: "NO_ACCOUNT" } },
    );
  }
  return account;
}

const ADDRESS_FIELDS = {
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  company: z.string().optional(),
  address_1: z.string().optional(),
  address_2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional().describe("State/county code, e.g. SP or CA."),
  postcode: z.string().optional(),
  country: z.string().optional().describe("ISO 3166-1 alpha-2 country code, e.g. BR."),
  phone: z.string().optional(),
};

function summarizeAccount(c) {
  return {
    id: c.id,
    email: c.email,
    firstName: c.first_name || null,
    lastName: c.last_name || null,
    phone: c.billing?.phone || null,
    billing: c.billing || null,
    shipping: c.shipping || null,
  };
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
        if (!email && !phone)
          throw toolError("BAD_INPUT", "Provide an email and/or a phone number.");
        if (!email && !phoneKey(phone)) {
          throw toolError("BAD_INPUT", `"${phone}" is not a phone number.`);
        }

        const account = await findAccount(email);

        // WooCommerce's order search is a substring match over billing
        // fields; search by the formatting-proof tail of the phone number
        // and verify every hit afterwards.
        const { items: found } = await wcList("/orders", {
          search: email || phoneKey(phone),
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
        const paging = { per_page: perPage, page: page ?? 1, orderby: "date", order: "desc" };
        // Registered customers get exact, countable paging by customer id;
        // guests only exist on their orders, so fall back to the fuzzy
        // search and verify each hit (counts are then of the verified page).
        const account = await findAccount(email);
        const { items, total, totalPages } = account
          ? await wcList("/orders", { customer: account.id, ...paging })
          : await wcList("/orders", { search: email, ...paging });
        const verified = account ? items : filterOrders(items, { email });
        return ok({
          items: verified.map(summarizeOrder),
          page: page ?? 1,
          // Counts are unknown for guests: the search total includes fuzzy hits.
          totalPages: account ? totalPages : null,
          total: account ? total : null,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "woocommerce_update_customer",
    "Update a registered customer's saved profile (WRITE): first name, last name and phone. " +
      "Identify the account by the email the customer gave and you verified. The account email " +
      "itself cannot be changed here (hand off to a person). Existing orders are not changed.",
    {
      email: z.string().describe("Email of the customer's account."),
      first_name: z.string().min(1).optional(),
      last_name: z.string().min(1).optional(),
      phone: z
        .string()
        .min(3)
        .optional()
        .describe("New phone number (saved on the billing profile)."),
    },
    async ({ email, first_name: firstName, last_name: lastName, phone }) => {
      try {
        if (firstName === undefined && lastName === undefined && phone === undefined) {
          throw toolError("BAD_INPUT", "Pass at least one of first_name, last_name or phone.");
        }
        const account = await requireAccount(email);
        const body = {};
        if (firstName !== undefined) body.first_name = firstName;
        if (lastName !== undefined) body.last_name = lastName;
        if (phone !== undefined) body.billing = { phone };
        const updated = await wcApi("PUT", `/customers/${account.id}`, { body });
        return ok({ updated: true, customer: summarizeAccount(updated) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "woocommerce_update_customer_address",
    "Change the billing or shipping address saved on a registered customer's account (WRITE), " +
      "used for future orders. Only the fields you pass change. Does not touch existing orders: " +
      "for an order not yet shipped use woocommerce_update_order_shipping_address.",
    {
      email: z.string().describe("Email of the customer's account."),
      address_type: z.enum(["billing", "shipping"]).describe("Which saved address to change."),
      address: z.object(ADDRESS_FIELDS).describe("Fields to change on that address."),
    },
    async ({ email, address_type: type, address }) => {
      try {
        const fields = Object.fromEntries(
          Object.entries(address).filter(([, value]) => value !== undefined),
        );
        if (!Object.keys(fields).length) {
          throw toolError("BAD_INPUT", "Pass at least one address field to change.");
        }
        const account = await requireAccount(email);
        const updated = await wcApi("PUT", `/customers/${account.id}`, {
          body: { [type]: { ...(account[type] || {}), ...fields } },
        });
        return ok({
          updated: true,
          addressType: type,
          address: updated?.[type] ?? null,
          customerId: account.id,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerCustomerTools, filterOrders, ADDRESS_FIELDS };
